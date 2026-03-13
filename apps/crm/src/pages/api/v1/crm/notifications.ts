import type { APIRoute, AstroCookies } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@shared/supabase/server";
import { asObject, asText, asUuid, toPositiveInt } from "@shared/portal/domain";
import { CRM_ADMIN_ROLES, type CrmPermission, resolveCrmOrgAccess } from "@shared/crm/access";

type NotificationType =
  | "in_app_message"
  | "email_outreach"
  | "lead_follow_up"
  | "call_reminder"
  | "system_alert";

type NotificationChannel = "in_app" | "email" | "whatsapp" | "phone";
type NotificationPriority = "low" | "normal" | "high" | "urgent";
type NotificationStatus = "pending" | "scheduled" | "sent" | "done" | "cancelled" | "failed";

type CreateNotificationBody = {
  organization_id?: string;
  notification_type?: NotificationType;
  channel?: NotificationChannel;
  priority?: NotificationPriority;
  status?: NotificationStatus;
  title?: string;
  body?: string | null;
  recipient_email?: string | null;
  recipient_phone?: string | null;
  assignee_email?: string | null;
  lead_id?: string | null;
  project_property_id?: string | null;
  due_at?: string | null;
  scheduled_for?: string | null;
  metadata?: Record<string, unknown> | null;
};

type PatchNotificationBody = {
  organization_id?: string;
  id?: string;
  action?: "mark_done" | "mark_sent" | "cancel" | "snooze_24h" | "reopen";
  notification_type?: NotificationType;
  channel?: NotificationChannel;
  priority?: NotificationPriority;
  status?: NotificationStatus;
  title?: string;
  body?: string | null;
  recipient_email?: string | null;
  recipient_phone?: string | null;
  assignee_email?: string | null;
  lead_id?: string | null;
  project_property_id?: string | null;
  due_at?: string | null;
  scheduled_for?: string | null;
  metadata?: Record<string, unknown> | null;
};

const normalizeNotificationType = (value: unknown): NotificationType => {
  if (
    value === "in_app_message" ||
    value === "email_outreach" ||
    value === "lead_follow_up" ||
    value === "call_reminder" ||
    value === "system_alert"
  ) {
    return value;
  }
  return "in_app_message";
};

const normalizeNotificationChannel = (value: unknown): NotificationChannel => {
  if (value === "in_app" || value === "email" || value === "whatsapp" || value === "phone") {
    return value;
  }
  return "in_app";
};

const normalizeNotificationPriority = (value: unknown): NotificationPriority => {
  if (value === "low" || value === "normal" || value === "high" || value === "urgent") {
    return value;
  }
  return "normal";
};

const normalizeNotificationStatus = (value: unknown): NotificationStatus => {
  if (
    value === "pending" ||
    value === "scheduled" ||
    value === "sent" ||
    value === "done" ||
    value === "cancelled" ||
    value === "failed"
  ) {
    return value;
  }
  return "pending";
};

const parseIsoDate = (value: unknown): string | null => {
  const text = asText(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const resolveAdminContext = async (
  cookies: AstroCookies,
  organizationIdHint: string | null,
  requiredPermission: CrmPermission
) => {
  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint,
    allowedRoles: CRM_ADMIN_ROLES,
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
      viewerEmail: access.data.auth_email,
    },
    error: null,
  };
};

const buildPendingCounters = (rows: Array<Record<string, unknown>>) => {
  let pendingCount = 0;
  let scheduledCount = 0;
  let overdueCount = 0;
  const now = Date.now();

  rows.forEach((row) => {
    const status = normalizeNotificationStatus(row.status);
    if (status === "pending") pendingCount += 1;
    if (status === "scheduled") scheduledCount += 1;

    const dueAt = parseIsoDate(row.due_at);
    if (!dueAt) return;
    const dueMillis = new Date(dueAt).getTime();
    if (Number.isNaN(dueMillis)) return;
    if ((status === "pending" || status === "scheduled") && dueMillis < now) {
      overdueCount += 1;
    }
  });

  return { pendingCount, scheduledCount, overdueCount };
};

export const GET: APIRoute = async ({ cookies, url }) => {
  const organizationIdHint = asText(url.searchParams.get("organization_id"));
  const status = asText(url.searchParams.get("status"));
  const notificationType = asText(url.searchParams.get("notification_type"));
  const channel = asText(url.searchParams.get("channel"));
  const q = asText(url.searchParams.get("q"));
  const dueFrom = parseIsoDate(url.searchParams.get("due_from"));
  const dueTo = parseIsoDate(url.searchParams.get("due_to"));
  const page = toPositiveInt(url.searchParams.get("page"), 1, 1, 10000);
  const perPage = toPositiveInt(url.searchParams.get("per_page"), 25, 1, 200);

  const admin = await resolveAdminContext(cookies, organizationIdHint, "crm.notifications.read");
  if (admin.error || !admin.data) {
    return jsonResponse(
      {
        ok: false,
        error: admin.error?.error ?? "auth_context_unresolved",
        details: admin.error?.details,
      },
      { status: admin.error?.status ?? 401 }
    );
  }

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: [],
      meta: {
        count: 0,
        total: 0,
        page,
        per_page: perPage,
        total_pages: 1,
        pending_count: 0,
        scheduled_count: 0,
        overdue_count: 0,
        persisted: false,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let query = client
    .schema("crm")
    .from("notifications")
    .select("*", { count: "exact" })
    .eq("organization_id", admin.data.organizationId)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (status) query = query.eq("status", normalizeNotificationStatus(status));
  if (notificationType) query = query.eq("notification_type", normalizeNotificationType(notificationType));
  if (channel) query = query.eq("channel", normalizeNotificationChannel(channel));
  if (dueFrom) query = query.gte("due_at", dueFrom);
  if (dueTo) query = query.lte("due_at", dueTo);
  if (q) {
    const safeQuery = q.replaceAll(",", " ");
    query = query.or(
      `title.ilike.%${safeQuery}%,body.ilike.%${safeQuery}%,recipient_email.ilike.%${safeQuery}%,recipient_phone.ilike.%${safeQuery}%`
    );
  }

  const { data, error, count } = await query;
  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_notifications_read_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const total = typeof count === "number" ? count : rows.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const counters = buildPendingCounters(rows);

  return jsonResponse({
    ok: true,
    data: rows,
    meta: {
      count: rows.length,
      total,
      page,
      per_page: perPage,
      total_pages: totalPages,
      pending_count: counters.pendingCount,
      scheduled_count: counters.scheduledCount,
      overdue_count: counters.overdueCount,
      storage: "supabase.crm.notifications",
    },
  });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await parseJsonBody<CreateNotificationBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationIdHint = asText(body.organization_id);
  const admin = await resolveAdminContext(cookies, organizationIdHint, "crm.notifications.write");
  if (admin.error || !admin.data) {
    return jsonResponse(
      {
        ok: false,
        error: admin.error?.error ?? "auth_context_unresolved",
        details: admin.error?.details,
      },
      { status: admin.error?.status ?? 401 }
    );
  }

  const title = asText(body.title);
  if (!title) return jsonResponse({ ok: false, error: "title_required" }, { status: 422 });

  const notificationType = normalizeNotificationType(body.notification_type);
  const channel = normalizeNotificationChannel(body.channel);
  const priority = normalizeNotificationPriority(body.priority);
  const dueAt = parseIsoDate(body.due_at);
  const scheduledFor = parseIsoDate(body.scheduled_for);
  const recipientEmail = asText(body.recipient_email)?.toLowerCase() ?? null;
  const recipientPhone = asText(body.recipient_phone);

  if (channel === "email" && !recipientEmail) {
    return jsonResponse({ ok: false, error: "recipient_email_required_for_email_channel" }, { status: 422 });
  }
  if ((channel === "whatsapp" || channel === "phone") && !recipientPhone) {
    return jsonResponse({ ok: false, error: "recipient_phone_required_for_phone_channel" }, { status: 422 });
  }
  if (notificationType === "lead_follow_up" && !dueAt) {
    return jsonResponse({ ok: false, error: "due_at_required_for_lead_follow_up" }, { status: 422 });
  }

  const leadId = asUuid(body.lead_id);
  const projectPropertyId = asUuid(body.project_property_id);
  const requestedStatus = asText(body.status);
  const resolvedStatus = requestedStatus
    ? normalizeNotificationStatus(requestedStatus)
    : dueAt && new Date(dueAt).getTime() > Date.now()
      ? "scheduled"
      : "pending";

  if (!hasSupabaseServerClient()) {
    return jsonResponse(
      {
        ok: true,
        data: {
          id: `ntf_${crypto.randomUUID()}`,
          organization_id: admin.data.organizationId,
          notification_type: notificationType,
          channel,
          priority,
          status: resolvedStatus,
          title,
          body: asText(body.body),
          recipient_email: recipientEmail,
          recipient_phone: recipientPhone,
          assignee_email: asText(body.assignee_email) ?? admin.data.viewerEmail,
          lead_id: leadId,
          project_property_id: projectPropertyId,
          due_at: dueAt,
          scheduled_for: scheduledFor,
          metadata: asObject(body.metadata),
          created_at: new Date().toISOString(),
        },
        meta: {
          persisted: false,
          storage: "mock_in_memory",
        },
      },
      { status: 201 }
    );
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const payload = {
    organization_id: admin.data.organizationId,
    notification_type: notificationType,
    channel,
    priority,
    status: resolvedStatus,
    title,
    body: asText(body.body),
    recipient_email: recipientEmail,
    recipient_phone: recipientPhone,
    assignee_email: asText(body.assignee_email) ?? admin.data.viewerEmail,
    lead_id: leadId,
    project_property_id: projectPropertyId,
    due_at: dueAt,
    scheduled_for: scheduledFor,
    metadata: asObject(body.metadata),
    created_by: admin.data.authUserId,
  };

  const { data, error } = await client.schema("crm").from("notifications").insert(payload).select("*").single();

  if (error) {
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
  const body = await parseJsonBody<PatchNotificationBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationIdHint = asText(body.organization_id);
  const notificationId = asUuid(body.id);
  if (!notificationId) return jsonResponse({ ok: false, error: "notification_id_required" }, { status: 422 });

  const admin = await resolveAdminContext(cookies, organizationIdHint, "crm.notifications.write");
  if (admin.error || !admin.data) {
    return jsonResponse(
      {
        ok: false,
        error: admin.error?.error ?? "auth_context_unresolved",
        details: admin.error?.details,
      },
      { status: admin.error?.status ?? 401 }
    );
  }

  const updatePayload: Record<string, unknown> = {};
  const action = asText(body.action);
  const nowIso = new Date().toISOString();

  if (action === "mark_done") {
    updatePayload.status = "done";
    updatePayload.completed_at = nowIso;
  } else if (action === "mark_sent") {
    updatePayload.status = "sent";
    updatePayload.sent_at = nowIso;
  } else if (action === "cancel") {
    updatePayload.status = "cancelled";
  } else if (action === "reopen") {
    updatePayload.status = "pending";
    updatePayload.completed_at = null;
    updatePayload.sent_at = null;
  } else if (action === "snooze_24h") {
    if (!hasSupabaseServerClient()) {
      updatePayload.status = "scheduled";
      updatePayload.due_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    } else {
      const client = getSupabaseServerClient();
      if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });
      const { data: currentRow, error: currentError } = await client
        .schema("crm")
        .from("notifications")
        .select("id, due_at")
        .eq("organization_id", admin.data.organizationId)
        .eq("id", notificationId)
        .maybeSingle();

      if (currentError) {
        return jsonResponse(
          {
            ok: false,
            error: "db_notifications_read_error",
            details: currentError.message,
          },
          { status: 500 }
        );
      }

      if (!currentRow) return jsonResponse({ ok: false, error: "notification_not_found" }, { status: 404 });

      const currentDue = parseIsoDate((currentRow as Record<string, unknown>).due_at) ?? nowIso;
      const nextDue = new Date(new Date(currentDue).getTime() + 24 * 60 * 60 * 1000).toISOString();
      updatePayload.status = "scheduled";
      updatePayload.due_at = nextDue;
    }
  }

  if (body.notification_type != null) updatePayload.notification_type = normalizeNotificationType(body.notification_type);
  if (body.channel != null) updatePayload.channel = normalizeNotificationChannel(body.channel);
  if (body.priority != null) updatePayload.priority = normalizeNotificationPriority(body.priority);
  if (body.status != null) updatePayload.status = normalizeNotificationStatus(body.status);
  if (body.title != null) updatePayload.title = asText(body.title);
  if (body.body != null) updatePayload.body = asText(body.body);
  if (body.recipient_email != null) updatePayload.recipient_email = asText(body.recipient_email)?.toLowerCase() ?? null;
  if (body.recipient_phone != null) updatePayload.recipient_phone = asText(body.recipient_phone);
  if (body.assignee_email != null) updatePayload.assignee_email = asText(body.assignee_email)?.toLowerCase() ?? null;
  if (body.lead_id != null) updatePayload.lead_id = asUuid(body.lead_id);
  if (body.project_property_id != null) updatePayload.project_property_id = asUuid(body.project_property_id);
  if (body.due_at != null) updatePayload.due_at = parseIsoDate(body.due_at);
  if (body.scheduled_for != null) updatePayload.scheduled_for = parseIsoDate(body.scheduled_for);
  if (body.metadata != null) updatePayload.metadata = asObject(body.metadata);

  if (!Object.keys(updatePayload).length) {
    return jsonResponse({ ok: false, error: "no_fields_to_update" }, { status: 422 });
  }

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: {
        id: notificationId,
        organization_id: admin.data.organizationId,
        ...updatePayload,
      },
      meta: {
        persisted: false,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const { data, error } = await client
    .schema("crm")
    .from("notifications")
    .update(updatePayload)
    .eq("organization_id", admin.data.organizationId)
    .eq("id", notificationId)
    .select("*")
    .single();

  if (error) {
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

  const admin = await resolveAdminContext(cookies, organizationIdHint, "crm.notifications.write");
  if (admin.error || !admin.data) {
    return jsonResponse(
      {
        ok: false,
        error: admin.error?.error ?? "auth_context_unresolved",
        details: admin.error?.details,
      },
      { status: admin.error?.status ?? 401 }
    );
  }

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: {
        id: notificationId,
        organization_id: admin.data.organizationId,
        status: "cancelled",
      },
      meta: {
        persisted: false,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const { data, error } = await client
    .schema("crm")
    .from("notifications")
    .update({ status: "cancelled" })
    .eq("organization_id", admin.data.organizationId)
    .eq("id", notificationId)
    .select("*")
    .single();

  if (error) {
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

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "POST", "PATCH", "DELETE"]);
