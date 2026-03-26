import type { APIRoute, AstroCookies } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { type CrmPermission, resolveCrmOrgAccess } from "@shared/crm/access";
import {
  buildNotificationEntitySummary,
  isMissingNotificationOrchestrationColumnError,
  readNotificationRows,
  syncNotificationsForOrganization,
} from "@shared/notifications/sync";
import {
  asText,
  asUuid,
  toPositiveInt,
} from "@shared/portal/domain";
import {
  normalizeNotificationChannel,
  normalizeNotificationEntityType,
  normalizeNotificationPriority,
  normalizeNotificationSourceType,
  normalizeNotificationStatus,
  normalizeNotificationType,
  NOTIFICATION_LIST_SELECT_COLUMNS,
  summarizeNotificationRows,
} from "@shared/notifications/domain";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@shared/supabase/server";

type NotificationAction =
  | "acknowledge"
  | "mark_done"
  | "mark_sent"
  | "snooze_24h"
  | "snooze_72h"
  | "reassign"
  | "cancel"
  | "reopen";

type NotificationMutationBody = {
  organization_id?: string | null;
  id?: string | null;
  action?: NotificationAction | null;
  notification_type?: string | null;
  channel?: string | null;
  priority?: string | null;
  status?: string | null;
  source_type?: string | null;
  rule_key?: string | null;
  entity_type?: string | null;
  title?: string | null;
  body?: string | null;
  recipient_email?: string | null;
  recipient_phone?: string | null;
  assignee_email?: string | null;
  assigned_user_id?: string | null;
  manager_user_id?: string | null;
  lead_id?: string | null;
  client_id?: string | null;
  deal_id?: string | null;
  reservation_id?: string | null;
  project_property_id?: string | null;
  due_at?: string | null;
  scheduled_for?: string | null;
  snoozed_until?: string | null;
  metadata?: Record<string, unknown> | null;
};

const parseIsoDate = (value: unknown): string | null => {
  const text = asText(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const resolveNotificationAccess = async (
  cookies: AstroCookies,
  organizationIdHint: string | null,
  requiredPermission: CrmPermission
) => {
  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint,
    allowedPermissions: [requiredPermission],
  });
  if (access.error || !access.data) {
    return {
      data: null,
      error: {
        status: access.error?.status ?? 401,
        error: access.error?.error ?? "auth_context_unresolved",
        details: access.error?.details,
      },
    };
  }

  return {
    data: {
      organizationId: access.data.organization_id,
      authUserId: asUuid(access.data.auth_user_id),
      viewerEmail: asText(access.data.auth_email)?.toLowerCase() ?? null,
      role: access.data.role,
    },
    error: null,
  };
};

const buildSearchExpression = (queryText: string) => {
  const safeQuery = queryText.replaceAll(",", " ").trim();
  if (!safeQuery.length) return null;
  return `title.ilike.%${safeQuery}%,rule_key.ilike.%${safeQuery}%,entity_type.ilike.%${safeQuery}%`;
};

const notificationsBackendUnavailableResponse = () =>
  jsonResponse(
    {
      ok: false,
      error: "notifications_backend_unavailable",
      details: "Supabase o la capa de notifications no estan disponibles en este entorno.",
    },
    { status: 503 }
  );

const notificationsSchemaIncompleteResponse = (details: string) =>
  jsonResponse(
    {
      ok: false,
      error: "notifications_schema_incomplete",
      details,
    },
    { status: 503 }
  );

const buildGetQuery = (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  organizationId: string,
  url: URL,
  authUserId: string | null
) => {
  const status = asText(url.searchParams.get("status"));
  const notificationType = asText(url.searchParams.get("notification_type"));
  const channel = asText(url.searchParams.get("channel"));
  const q = asText(url.searchParams.get("q"));
  const dueFrom = parseIsoDate(url.searchParams.get("due_from"));
  const dueTo = parseIsoDate(url.searchParams.get("due_to"));
  const sourceType = asText(url.searchParams.get("source_type"));
  const ruleKey = asText(url.searchParams.get("rule_key"));
  const entityType = asText(url.searchParams.get("entity_type"));
  const leadId = asUuid(url.searchParams.get("lead_id"));
  const dealId = asUuid(url.searchParams.get("deal_id"));
  const clientId = asUuid(url.searchParams.get("client_id"));
  const reservationId = asUuid(url.searchParams.get("reservation_id"));
  const assignedUserId = asUuid(url.searchParams.get("assigned_user_id"));
  const managerUserId = asUuid(url.searchParams.get("manager_user_id"));
  const view = asText(url.searchParams.get("view"));
  const searchExpression = q ? buildSearchExpression(q) : null;

  let query = client
    .schema("crm")
    .from("notifications")
    .select(NOTIFICATION_LIST_SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", normalizeNotificationStatus(status));
  if (notificationType) query = query.eq("notification_type", normalizeNotificationType(notificationType));
  if (channel) query = query.eq("channel", normalizeNotificationChannel(channel));
  if (dueFrom) query = query.gte("due_at", dueFrom);
  if (dueTo) query = query.lte("due_at", dueTo);
  if (sourceType) query = query.eq("source_type", normalizeNotificationSourceType(sourceType));
  if (ruleKey) query = query.eq("rule_key", ruleKey);
  if (entityType) query = query.eq("entity_type", normalizeNotificationEntityType(entityType));
  if (leadId) query = query.eq("lead_id", leadId);
  if (dealId) query = query.eq("deal_id", dealId);
  if (clientId) query = query.eq("client_id", clientId);
  if (reservationId) query = query.eq("reservation_id", reservationId);
  if (assignedUserId) query = query.eq("assigned_user_id", assignedUserId);
  if (managerUserId) query = query.eq("manager_user_id", managerUserId);

  let combinedMineSearch = false;
  if (view === "mine" && authUserId) {
    if (searchExpression) {
      query = query.or(
        `and(assigned_user_id.eq.${authUserId},or(${searchExpression})),and(manager_user_id.eq.${authUserId},or(${searchExpression}))`
      );
      combinedMineSearch = true;
    } else {
      query = query.or(`assigned_user_id.eq.${authUserId},manager_user_id.eq.${authUserId}`);
    }
  } else if (view === "team") {
    query = query.is("assigned_user_id", null);
  } else if (view === "escalated" && authUserId) {
    query = query.eq("manager_user_id", authUserId);
  } else if (view === "manual") {
    query = query.eq("source_type", "manual");
  } else if (view === "system") {
    query = query.eq("source_type", "system");
  }

  if (searchExpression && !combinedMineSearch) {
    query = query.or(searchExpression);
  }

  return { query };
};

export const GET: APIRoute = async ({ cookies, url }) => {
  const organizationIdHint = asText(url.searchParams.get("organization_id"));
  const page = toPositiveInt(url.searchParams.get("page"), 1, 1, 10000);
  const perPage = toPositiveInt(url.searchParams.get("per_page"), 25, 1, 200);

  const access = await resolveNotificationAccess(cookies, organizationIdHint, "crm.notifications.read");
  if (access.error || !access.data) {
    return jsonResponse(
      {
        ok: false,
        error: access.error?.error ?? "auth_context_unresolved",
        details: access.error?.details,
      },
      { status: access.error?.status ?? 401 }
    );
  }

  if (!hasSupabaseServerClient()) return notificationsBackendUnavailableResponse();

  const client = getSupabaseServerClient();
  if (!client) return notificationsBackendUnavailableResponse();

  const from = (page - 1) * perPage;
  const to = from + perPage;
  const { query } = buildGetQuery(client, access.data.organizationId, url, access.data.authUserId);
  const { data, error } = await query.range(from, to);
  if (error) {
    if (isMissingNotificationOrchestrationColumnError(error.message)) {
      return notificationsSchemaIncompleteResponse(error.message);
    }
    return jsonResponse(
      {
        ok: false,
        error: "db_notifications_read_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  const fetchedRows = (data ?? []) as Array<Record<string, unknown>>;
  const hasNextPage = fetchedRows.length > perPage;
  const pagedRows = hasNextPage ? fetchedRows.slice(0, perPage) : fetchedRows;
  const summary = summarizeNotificationRows(pagedRows, { activeLimit: 10, recentLimit: 10 });

  return jsonResponse({
    ok: true,
    data: pagedRows,
    meta: {
      count: pagedRows.length,
      page,
      per_page: perPage,
      has_next_page: hasNextPage,
      pending_count_page: summary.pending_total,
      scheduled_count_page: summary.scheduled_total,
      overdue_count_page: summary.overdue_total,
      open_total: summary.open_total,
      storage: "supabase.crm.notifications",
    },
  });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await parseJsonBody<NotificationMutationBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationIdHint = asText(body.organization_id);
  const access = await resolveNotificationAccess(cookies, organizationIdHint, "crm.notifications.write");
  if (access.error || !access.data) {
    return jsonResponse(
      {
        ok: false,
        error: access.error?.error ?? "auth_context_unresolved",
        details: access.error?.details,
      },
      { status: access.error?.status ?? 401 }
    );
  }

  const title = asText(body.title);
  if (!title) return jsonResponse({ ok: false, error: "title_required" }, { status: 422 });

  const payload = {
    organization_id: access.data.organizationId,
    notification_type: normalizeNotificationType(body.notification_type),
    channel: normalizeNotificationChannel(body.channel),
    priority: normalizeNotificationPriority(body.priority),
    status: normalizeNotificationStatus(body.status ?? "pending"),
    source_type: normalizeNotificationSourceType(body.source_type ?? "manual"),
    rule_key: asText(body.rule_key),
    entity_type: normalizeNotificationEntityType(body.entity_type ?? "generic"),
    title,
    body: asText(body.body),
    recipient_email: asText(body.recipient_email)?.toLowerCase() ?? null,
    recipient_phone: asText(body.recipient_phone),
    assignee_email: asText(body.assignee_email)?.toLowerCase() ?? access.data.viewerEmail,
    assigned_user_id: asUuid(body.assigned_user_id),
    manager_user_id: asUuid(body.manager_user_id),
    lead_id: asUuid(body.lead_id),
    client_id: asUuid(body.client_id),
    deal_id: asUuid(body.deal_id),
    reservation_id: asUuid(body.reservation_id),
    project_property_id: asUuid(body.project_property_id),
    due_at: parseIsoDate(body.due_at),
    scheduled_for: parseIsoDate(body.scheduled_for),
    snoozed_until: parseIsoDate(body.snoozed_until),
    metadata: body.metadata ?? {},
    created_by: access.data.authUserId,
  };

  if (!hasSupabaseServerClient()) return notificationsBackendUnavailableResponse();

  const client = getSupabaseServerClient();
  if (!client) return notificationsBackendUnavailableResponse();

  const { data, error } = await client.schema("crm").from("notifications").insert(payload).select("*").single();
  if (error) {
    if (isMissingNotificationOrchestrationColumnError(error.message)) {
      return notificationsSchemaIncompleteResponse(error.message);
    }
    return jsonResponse(
      {
        ok: false,
        error: "db_notifications_insert_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  return jsonResponse(
    {
      ok: true,
      data,
      meta: {
        storage: "supabase.crm.notifications",
      },
    },
    { status: 201 }
  );
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const body = await parseJsonBody<NotificationMutationBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationIdHint = asText(body.organization_id);
  const notificationId = asUuid(body.id);
  if (!notificationId) return jsonResponse({ ok: false, error: "notification_id_required" }, { status: 422 });

  const access = await resolveNotificationAccess(cookies, organizationIdHint, "crm.notifications.write");
  if (access.error || !access.data) {
    return jsonResponse(
      {
        ok: false,
        error: access.error?.error ?? "auth_context_unresolved",
        details: access.error?.details,
      },
      { status: access.error?.status ?? 401 }
    );
  }

  const nowIso = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {};
  const action = asText(body.action);

  if (action === "acknowledge") {
    updatePayload.read_at = nowIso;
    updatePayload.acknowledged_at = nowIso;
  } else if (action === "mark_done") {
    updatePayload.status = "done";
    updatePayload.completed_at = nowIso;
    updatePayload.resolved_at = nowIso;
  } else if (action === "mark_sent") {
    updatePayload.status = "sent";
    updatePayload.sent_at = nowIso;
  } else if (action === "cancel") {
    updatePayload.status = "cancelled";
    updatePayload.resolved_at = nowIso;
  } else if (action === "reopen") {
    updatePayload.status = "pending";
    updatePayload.completed_at = null;
    updatePayload.sent_at = null;
    updatePayload.resolved_at = null;
    updatePayload.read_at = null;
    updatePayload.acknowledged_at = null;
  } else if (action === "snooze_24h" || action === "snooze_72h") {
    const hours = action === "snooze_72h" ? 72 : 24;
    updatePayload.status = "scheduled";
    updatePayload.snoozed_until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    updatePayload.due_at = updatePayload.snoozed_until;
  } else if (action === "reassign") {
    if (!asUuid(body.assigned_user_id)) {
      return jsonResponse({ ok: false, error: "assigned_user_id_required_for_reassign" }, { status: 422 });
    }
    updatePayload.assigned_user_id = asUuid(body.assigned_user_id);
  }

  if (body.notification_type != null) updatePayload.notification_type = normalizeNotificationType(body.notification_type);
  if (body.channel != null) updatePayload.channel = normalizeNotificationChannel(body.channel);
  if (body.priority != null) updatePayload.priority = normalizeNotificationPriority(body.priority);
  if (body.status != null) updatePayload.status = normalizeNotificationStatus(body.status);
  if (body.source_type != null) updatePayload.source_type = normalizeNotificationSourceType(body.source_type);
  if (body.rule_key != null) updatePayload.rule_key = asText(body.rule_key);
  if (body.entity_type != null) updatePayload.entity_type = normalizeNotificationEntityType(body.entity_type);
  if (body.title != null) updatePayload.title = asText(body.title);
  if (body.body != null) updatePayload.body = asText(body.body);
  if (body.recipient_email != null) updatePayload.recipient_email = asText(body.recipient_email)?.toLowerCase() ?? null;
  if (body.recipient_phone != null) updatePayload.recipient_phone = asText(body.recipient_phone);
  if (body.assignee_email != null) updatePayload.assignee_email = asText(body.assignee_email)?.toLowerCase() ?? null;
  if (body.assigned_user_id != null) updatePayload.assigned_user_id = asUuid(body.assigned_user_id);
  if (body.manager_user_id != null) updatePayload.manager_user_id = asUuid(body.manager_user_id);
  if (body.lead_id != null) updatePayload.lead_id = asUuid(body.lead_id);
  if (body.client_id != null) updatePayload.client_id = asUuid(body.client_id);
  if (body.deal_id != null) updatePayload.deal_id = asUuid(body.deal_id);
  if (body.reservation_id != null) updatePayload.reservation_id = asUuid(body.reservation_id);
  if (body.project_property_id != null) updatePayload.project_property_id = asUuid(body.project_property_id);
  if (body.due_at != null) updatePayload.due_at = parseIsoDate(body.due_at);
  if (body.scheduled_for != null) updatePayload.scheduled_for = parseIsoDate(body.scheduled_for);
  if (body.snoozed_until != null) updatePayload.snoozed_until = parseIsoDate(body.snoozed_until);
  if (body.metadata != null) updatePayload.metadata = body.metadata;

  if (!Object.keys(updatePayload).length) {
    return jsonResponse({ ok: false, error: "no_fields_to_update" }, { status: 422 });
  }

  if (!hasSupabaseServerClient()) return notificationsBackendUnavailableResponse();

  const client = getSupabaseServerClient();
  if (!client) return notificationsBackendUnavailableResponse();

  const { data, error } = await client
    .schema("crm")
    .from("notifications")
    .update(updatePayload)
    .eq("organization_id", access.data.organizationId)
    .eq("id", notificationId)
    .select("*")
    .single();

  if (error) {
    if (isMissingNotificationOrchestrationColumnError(error.message)) {
      return notificationsSchemaIncompleteResponse(error.message);
    }
    return jsonResponse(
      {
        ok: false,
        error: "db_notifications_update_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  return jsonResponse({
    ok: true,
    data,
    meta: {
      storage: "supabase.crm.notifications",
    },
  });
};

export const DELETE: APIRoute = async ({ request, url, cookies }) => {
  const body = await parseJsonBody<{ organization_id?: string; id?: string }>(request);
  const organizationIdHint = asText(body?.organization_id) ?? asText(url.searchParams.get("organization_id"));
  const notificationId = asUuid(body?.id) ?? asUuid(url.searchParams.get("id"));
  if (!notificationId) return jsonResponse({ ok: false, error: "notification_id_required" }, { status: 422 });

  const access = await resolveNotificationAccess(cookies, organizationIdHint, "crm.notifications.write");
  if (access.error || !access.data) {
    return jsonResponse(
      {
        ok: false,
        error: access.error?.error ?? "auth_context_unresolved",
        details: access.error?.details,
      },
      { status: access.error?.status ?? 401 }
    );
  }

  if (!hasSupabaseServerClient()) return notificationsBackendUnavailableResponse();

  const client = getSupabaseServerClient();
  if (!client) return notificationsBackendUnavailableResponse();

  const { data, error } = await client
    .schema("crm")
    .from("notifications")
    .update({ status: "cancelled", resolved_at: new Date().toISOString() })
    .eq("organization_id", access.data.organizationId)
    .eq("id", notificationId)
    .select("*")
    .single();

  if (error) {
    if (isMissingNotificationOrchestrationColumnError(error.message)) {
      return notificationsSchemaIncompleteResponse(error.message);
    }
    return jsonResponse(
      {
        ok: false,
        error: "db_notifications_cancel_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  return jsonResponse({
    ok: true,
    data,
    meta: {
      storage: "supabase.crm.notifications",
    },
  });
};

export const PUT: APIRoute = async ({ request, cookies }) => {
  const body = (await parseJsonBody<{ organization_id?: string; entity_type?: string; lead_id?: string; deal_id?: string; client_id?: string; reservation_id?: string }>(request)) ?? {};
  const organizationIdHint = asText(body.organization_id);

  const access = await resolveNotificationAccess(cookies, organizationIdHint, "crm.notifications.read");
  if (access.error || !access.data) {
    return jsonResponse(
      {
        ok: false,
        error: access.error?.error ?? "auth_context_unresolved",
        details: access.error?.details,
      },
      { status: access.error?.status ?? 401 }
    );
  }

  if (!hasSupabaseServerClient()) return notificationsBackendUnavailableResponse();

  const client = getSupabaseServerClient();
  if (!client) return notificationsBackendUnavailableResponse();
  try {
    const rows = await readNotificationRows(client, access.data.organizationId, {
      includeClosed: true,
      leadId: asUuid(body.lead_id),
      dealId: asUuid(body.deal_id),
      clientId: asUuid(body.client_id),
      reservationId: asUuid(body.reservation_id),
    });
    return jsonResponse({ ok: true, data: buildNotificationEntitySummary(rows) });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    if (isMissingNotificationOrchestrationColumnError(details)) {
      return notificationsSchemaIncompleteResponse(details);
    }
    return jsonResponse(
      {
        ok: false,
        error: "db_notifications_summary_read_error",
        details,
      },
      { status: 500 }
    );
  }
};

export const OPTIONS: APIRoute = async () => methodNotAllowed(["GET", "POST", "PATCH", "DELETE", "PUT"]);

export { buildNotificationEntitySummary, readNotificationRows, syncNotificationsForOrganization };
