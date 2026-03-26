import type { CrmAccessData, CrmPermission } from "@shared/crm/access";
import type {
  DashboardAlert,
  DashboardHomeResponse,
  DashboardInboxItem,
  DashboardQuickLink,
  DashboardReservationStatus,
  DashboardSummaryCard,
  DashboardWindow,
} from "@shared/dashboard/home";
import { DASHBOARD_RESERVATION_STATUSES, normalizeDashboardScope, normalizeDashboardWindow } from "@shared/dashboard/home";
import { hydrateDealRows } from "@shared/deals/crud";
import { DEAL_SELECT_COLUMNS, DEAL_STAGES } from "@shared/deals/domain";
import { buildLeadRows, CONTACT_SELECT_COLUMNS, LEAD_SELECT_COLUMNS } from "@shared/leads/domain";
import { mapNotificationRow } from "@shared/notifications/domain";
import { isMissingNotificationOrchestrationColumnError, readNotificationRows } from "@shared/notifications/sync";
import { asBoolean, asText, asUuid } from "@shared/portal/domain";

const IN_QUERY_CHUNK_SIZE = 200;
const MAX_INBOX_LIMIT = 20;

const RESERVATION_ACTIVE_STATUSES = new Set<DashboardReservationStatus>([
  "pre_registered",
  "reservation_sent",
  "reserved",
  "adhesion_paid",
  "contract_signed",
]);

const LEAD_OPEN_STATUS_BLOCKLIST = new Set(["converted", "won", "lost", "discarded", "junk"]);
const RESERVATION_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "client_id",
  "project_property_id",
  "reservation_status",
  "source_file",
  "is_document_copy_received",
  "is_aml_form_received",
  "is_uploaded_to_folder",
  "created_at",
  "updated_at",
].join(", ");

const PROPERTY_LABEL_SELECT_COLUMNS = [
  "id",
  "legacy_code",
  "translations",
  "property_data",
  "parent_property_id",
  "record_type",
  "status",
].join(", ");

const VISIT_REQUEST_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "lead_id",
  "project_property_id",
  "status",
  "created_at",
  "updated_at",
].join(", ");

const COMMISSION_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "lead_id",
  "deal_id",
  "project_property_id",
  "status",
  "created_at",
  "updated_at",
].join(", ");

type QueryChunkResult = {
  data: Record<string, unknown>[] | null;
  error: { message: string; code?: string; details?: string } | null;
};

type DashboardBuildOptions = {
  scope?: string | null;
  window?: string | null;
  inboxLimit?: number | null;
};

const hasPermission = (permissions: ReadonlyArray<CrmPermission>, permission: CrmPermission) => permissions.includes(permission);

const dedupeUuids = (values: Array<string | null | undefined>) =>
  Array.from(new Set(values.map((value) => asUuid(value ?? null)).filter((value): value is string => Boolean(value))));

const readAllPages = async (
  loader: (from: number, to: number) => Promise<QueryChunkResult>,
  pageSize = 1000
): Promise<Record<string, unknown>[]> => {
  const rows: Record<string, unknown>[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await loader(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = Array.isArray(data) ? data : [];
    if (!chunk.length) break;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += chunk.length;
  }

  return rows;
};

const readRowsByIds = async (
  client: any,
  organizationId: string,
  input: {
    table: "contacts" | "clients" | "properties" | "leads" | "deals";
    select: string;
    ids: string[];
    errorPrefix: string;
  }
) => {
  const uniqueIds = dedupeUuids(input.ids);
  const byId = new Map<string, Record<string, unknown>>();
  if (!uniqueIds.length) return byId;

  for (let index = 0; index < uniqueIds.length; index += IN_QUERY_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(index, index + IN_QUERY_CHUNK_SIZE);
    const { data, error } = await client
      .schema("crm")
      .from(input.table)
      .select(input.select)
      .eq("organization_id", organizationId)
      .in("id", chunk);

    if (error) throw new Error(`${input.errorPrefix}:${error.message}`);
    (data ?? []).forEach((row: Record<string, unknown>) => {
      const id = asUuid(row.id);
      if (id) byId.set(id, row);
    });
  }

  return byId;
};

const readPropertiesWithParentsByIds = async (client: any, organizationId: string, ids: string[]) => {
  const direct = await readRowsByIds(client, organizationId, {
    table: "properties",
    select: PROPERTY_LABEL_SELECT_COLUMNS,
    ids,
    errorPrefix: "db_properties_read_error",
  });
  const parentIds = dedupeUuids(Array.from(direct.values()).map((row) => asText(row.parent_property_id)));
  if (!parentIds.length) return direct;

  const parents = await readRowsByIds(client, organizationId, {
    table: "properties",
    select: PROPERTY_LABEL_SELECT_COLUMNS,
    ids: parentIds,
    errorPrefix: "db_project_properties_read_error",
  });
  parents.forEach((value, key) => direct.set(key, value));
  return direct;
};

const toMillis = (value: unknown): number | null => {
  const text = asText(value);
  if (!text) return null;
  const parsed = new Date(text).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const toDateOnlyMillis = (value: unknown) => {
  const text = asText(value);
  if (!text) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : text;
  const parsed = new Date(normalized).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const startOfToday = (now: Date) => {
  const next = new Date(now);
  next.setHours(0, 0, 0, 0);
  return next;
};

const windowStartDate = (window: DashboardWindow, now: Date) => {
  if (window === "today") return startOfToday(now);
  const next = startOfToday(now);
  next.setDate(next.getDate() - (window === "30d" ? 29 : 6));
  return next;
};

const hoursSince = (value: unknown, nowMillis: number) => {
  const millis = toMillis(value);
  if (millis == null) return null;
  return (nowMillis - millis) / 3600000;
};

const daysSince = (value: unknown, nowMillis: number) => {
  const hours = hoursSince(value, nowMillis);
  return hours == null ? null : Math.floor(hours / 24);
};

const isOnOrAfter = (value: unknown, start: Date) => {
  const millis = toMillis(value);
  return millis != null && millis >= start.getTime();
};

const isMissingRelationError = (error: unknown, relation: string) => {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  const code = String(row.code ?? "");
  const message = String(row.message ?? "").toLowerCase();
  return code === "PGRST205" || message.includes(relation.toLowerCase());
};

const formatAgeLabel = (value: unknown, nowMillis: number, prefix = "Hace") => {
  const hours = hoursSince(value, nowMillis);
  if (hours == null) return "-";
  if (hours < 1) return `${prefix} < 1 h`;
  if (hours < 24) return `${prefix} ${Math.round(hours)} h`;
  return `${prefix} ${Math.floor(hours / 24)} d`;
};

const priorityRank = (priority: DashboardPriority) => (priority === "urgent" ? 0 : priority === "high" ? 1 : 2);

const sortInboxItems = (items: DashboardInboxItem[]) =>
  [...items].sort((left, right) => {
    const priorityDelta = priorityRank(left.priority) - priorityRank(right.priority);
    if (priorityDelta !== 0) return priorityDelta;
    return (toMillis(left.date) ?? 0) - (toMillis(right.date) ?? 0) || left.title.localeCompare(right.title, "es");
  });

const clampInboxLimit = (value: number | null | undefined) => {
  if (!Number.isFinite(value)) return 8;
  return Math.max(1, Math.min(MAX_INBOX_LIMIT, Math.floor(Number(value))));
};

const sum = (values: Array<number | null | undefined>) =>
  values.reduce((acc, value) => acc + (typeof value === "number" && Number.isFinite(value) ? value : 0), 0);

const stageLabel = (stage: string) => {
  switch (stage) {
    case "qualification": return "Cualificacion";
    case "visit": return "Visita";
    case "offer": return "Oferta";
    case "negotiation": return "Negociacion";
    case "reservation": return "Reserva";
    case "contract": return "Contrato";
    case "won": return "Ganada";
    case "lost": return "Perdida";
    default: return stage;
  }
};

const reservationStatusLabel = (status: string) => {
  switch (status) {
    case "pre_registered": return "Preinscrito";
    case "reservation_sent": return "Reserva enviada";
    case "reserved": return "Reservado";
    case "adhesion_paid": return "Adhesion pagada";
    case "contract_signed": return "Contrato firmado";
    case "cancelled": return "Cancelado";
    case "discarded": return "Descartado";
    default: return "Otro";
  }
};

const createSummaryCard = (
  id: string,
  label: string,
  value: number | null,
  sublabel: string,
  href: string | null,
  tone: DashboardSummaryCard["tone"],
  enabled: boolean
): DashboardSummaryCard => ({ id, label, value: enabled ? value : null, sublabel, href, tone, enabled });

export const createDashboardHomeSkeleton = (
  input: { scope?: string | null; window?: string | null } = {},
  viewer: Partial<DashboardHomeResponse["viewer"]> = {}
): DashboardHomeResponse => ({
  viewer: {
    auth_user_id: viewer.auth_user_id ?? null,
    auth_email: viewer.auth_email ?? null,
    organization_id: viewer.organization_id ?? null,
    role: viewer.role ?? null,
    permissions: viewer.permissions ?? [],
  },
  filters: {
    scope: normalizeDashboardScope(input.scope),
    window: normalizeDashboardWindow(input.window),
    as_of: new Date().toISOString(),
  },
  summary: [
    createSummaryCard("leads_new", "Leads nuevos", null, "Sin datos", "/crm/leads/", "neutral", false),
    createSummaryCard("leads_open", "Leads abiertos", null, "Sin datos", "/crm/leads/", "neutral", false),
    createSummaryCard("deals_active", "Deals activos", null, "Sin datos", "/crm/deals/", "neutral", false),
    createSummaryCard("deals_risk", "Deals en riesgo", null, "Sin datos", "/crm/deals/?only_open=1", "neutral", false),
    createSummaryCard("reservations_active", "Reservas activas", null, "Sin datos", "/crm/clients/dashboard/", "neutral", false),
    createSummaryCard("portal_pending", "Portal pendiente", null, "Sin datos", "/crm/portal/operations/", "neutral", false),
  ],
  alerts: [],
  inbox: { mine: [], team: [], total_mine: 0, total_team: 0 },
  pipeline: {
    enabled: false,
    by_stage: DEAL_STAGES.map((stage) => ({ stage, label: stageLabel(stage), total: 0, expected_value_total: 0, is_terminal: stage === "won" || stage === "lost" })),
    open_total: 0,
    overdue_total: 0,
    missing_expected_close_total: 0,
    expected_value_open_total: 0,
  },
  reservations: {
    enabled: false,
    active_total: 0,
    docs_pending_total: 0,
    status_breakdown: DASHBOARD_RESERVATION_STATUSES.map((status) => ({ status, label: reservationStatusLabel(status), total: 0, is_active: RESERVATION_ACTIVE_STATUSES.has(status) })),
  },
  portal: {
    enabled: false,
    visit_requests: { total: 0, requested: 0, confirmed: 0, declined: 0, done: 0, no_show: 0, cancelled: 0 },
    commissions: { total: 0, pending: 0, approved: 0, paid: 0, cancelled: 0 },
  },
  notifications: { enabled: false, pending_count: 0, scheduled_count: 0, overdue_count: 0 },
  quick_links: [],
});

export const buildDashboardHome = async (
  client: any,
  access: CrmAccessData,
  options: DashboardBuildOptions = {}
): Promise<DashboardHomeResponse> => {
  const scope = normalizeDashboardScope(options.scope);
  const window = normalizeDashboardWindow(options.window);
  const inboxLimit = clampInboxLimit(options.inboxLimit);
  const now = new Date();
  const nowMillis = now.getTime();
  const todayStartMillis = startOfToday(now).getTime();
  const createdWindowStart = windowStartDate(window, now);
  const authUserId = asUuid(access.auth_user_id);
  const authEmail = asText(access.auth_email)?.toLowerCase() ?? null;
  const permissions = access.permissions;
  const organizationId = access.organization_id;

  const response = createDashboardHomeSkeleton(
    { scope, window },
    {
      auth_user_id: authUserId,
      auth_email: authEmail,
      organization_id: organizationId,
      role: access.role,
      permissions,
    }
  );

  const quickLinks: DashboardQuickLink[] = [
    { id: "leads", label: "Leads", href: "/crm/leads/", permission_required: "crm.leads.read" },
    { id: "clients", label: "Clientes", href: "/crm/clients/", permission_required: "crm.clients.read" },
    { id: "deals", label: "Deals", href: "/crm/deals/", permission_required: "crm.deals.read" },
    { id: "deals_new", label: "Nuevo deal", href: "/crm/deals/nuevo/", permission_required: "crm.deals.write" },
    { id: "portal", label: "Portal operativa", href: "/crm/portal/operations/", permission_required: "crm.portal.read" },
    { id: "notifications", label: "Notificaciones", href: "/crm/notifications/", permission_required: "crm.notifications.read" },
  ];
  response.quick_links = quickLinks.filter((entry) => !entry.permission_required || hasPermission(permissions, entry.permission_required));

  const mineInbox: DashboardInboxItem[] = [];
  const teamInbox: DashboardInboxItem[] = [];
  let dealsAtRiskTotal = 0;
  let reservationDocsPendingTotal = 0;
  let requestedVisitsTotal = 0;
  let pendingCommissionsTotal = 0;
  let persistedNotifications: Array<Record<string, unknown>> = [];
  let hasPortalData = false;

  if (hasPermission(permissions, "crm.notifications.read")) {
    try {
      persistedNotifications = await readNotificationRows(client, organizationId, {
        includeClosed: false,
      });
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      if (isMissingNotificationOrchestrationColumnError(details) || isMissingRelationError(error, "notifications")) {
        throw new Error(`notifications_schema_incomplete:${details}`);
      }
      throw error;
    }
  }

  if (hasPermission(permissions, "crm.leads.read")) {
    const leadRows = await readAllPages(async (from, to) => {
      const { data, error } = await client
        .schema("crm")
        .from("leads")
        .select(LEAD_SELECT_COLUMNS)
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false })
        .range(from, to);
      return {
        data: (data ?? []) as Record<string, unknown>[],
        error: error ? { message: error.message, code: error.code, details: error.details } : null,
      };
    });

    const leadContactIds = dedupeUuids(leadRows.map((row) => asText(row.contact_id)));
    const leadPropertyIds = dedupeUuids(leadRows.map((row) => asText(row.property_id)));
    const [leadContactsById, leadPropertiesById] = await Promise.all([
      readRowsByIds(client, organizationId, {
        table: "contacts",
        select: CONTACT_SELECT_COLUMNS,
        ids: leadContactIds,
        errorPrefix: "db_contacts_read_error",
      }),
      readPropertiesWithParentsByIds(client, organizationId, leadPropertyIds),
    ]);

    const leads = buildLeadRows(leadRows, leadContactsById, leadPropertiesById);
    const openLeads = leads.filter((row) => !LEAD_OPEN_STATUS_BLOCKLIST.has(String(row.status ?? "").toLowerCase()));
    const newLeadsTotal = leads.filter((row) => isOnOrAfter(row.created_at, createdWindowStart)).length;
    response.summary[0] = createSummaryCard(
      "leads_new",
      "Leads nuevos",
      newLeadsTotal,
      window === "today" ? "Entrados hoy" : `Entrados en ${window === "30d" ? "30" : "7"} dias`,
      "/crm/leads/",
      newLeadsTotal > 0 ? "ok" : "neutral",
      true
    );
    response.summary[1] = createSummaryCard(
      "leads_open",
      "Leads abiertos",
      openLeads.length,
      "Backlog comercial actual",
      "/crm/leads/",
      openLeads.length > 0 ? "warn" : "neutral",
      true
    );

  }

  if (hasPermission(permissions, "crm.deals.read")) {
    const dealRows = await readAllPages(async (from, to) => {
      const { data, error } = await client
        .schema("crm")
        .from("deals")
        .select(DEAL_SELECT_COLUMNS)
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false })
        .range(from, to);
      return {
        data: (data ?? []) as Record<string, unknown>[],
        error: error ? { message: error.message, code: error.code, details: error.details } : null,
      };
    });

    const deals = await hydrateDealRows(client, organizationId, dealRows);
    const openDeals = deals.filter((row) => !row.is_terminal);
    const overdueDeals = openDeals.filter((row) => {
      const expectedMillis = toDateOnlyMillis(row.expected_close_date);
      return expectedMillis != null && expectedMillis < todayStartMillis;
    });
    const missingCloseDateDeals = openDeals.filter(
      (row) => !asText(row.expected_close_date) && (hoursSince(row.updated_at, nowMillis) ?? 0) > 72
    );
    dealsAtRiskTotal = new Set(
      [...overdueDeals.map((row) => row.id), ...missingCloseDateDeals.map((row) => row.id)].filter(Boolean)
    ).size;

    response.summary[2] = createSummaryCard(
      "deals_active",
      "Deals activos",
      openDeals.length,
      "Pipeline abierto",
      "/crm/deals/?only_open=1",
      openDeals.length > 0 ? "ok" : "neutral",
      true
    );
    response.summary[3] = createSummaryCard(
      "deals_risk",
      "Deals en riesgo",
      dealsAtRiskTotal,
      "Vencidos o sin fecha estimada",
      "/crm/deals/?only_open=1",
      dealsAtRiskTotal > 0 ? (dealsAtRiskTotal >= 5 ? "danger" : "warn") : "neutral",
      true
    );

    response.pipeline = {
      enabled: true,
      by_stage: DEAL_STAGES.map((stage) => {
        const stageDeals = deals.filter((row) => row.stage === stage);
        return {
          stage,
          label: stageLabel(stage),
          total: stageDeals.length,
          expected_value_total: sum(stageDeals.map((row) => row.expected_value)),
          is_terminal: stage === "won" || stage === "lost",
        };
      }),
      open_total: openDeals.length,
      overdue_total: overdueDeals.length,
      missing_expected_close_total: missingCloseDateDeals.length,
      expected_value_open_total: sum(openDeals.map((row) => row.expected_value)),
    };

  }

  if (hasPermission(permissions, "crm.clients.read")) {
    try {
      const reservationRows = await readAllPages(async (from, to) => {
        const { data, error } = await client
          .schema("crm")
          .from("client_project_reservations")
          .select(RESERVATION_SELECT_COLUMNS)
          .eq("organization_id", organizationId)
          .order("updated_at", { ascending: false })
          .range(from, to);
        return {
          data: (data ?? []) as Record<string, unknown>[],
          error: error ? { message: error.message, code: error.code, details: error.details } : null,
        };
      });

      const activeReservations = reservationRows.filter((row) =>
        RESERVATION_ACTIVE_STATUSES.has((asText(row.reservation_status) ?? "other") as DashboardReservationStatus)
      );
      const docsPendingRows = activeReservations.filter(
        (row) =>
          asBoolean(row.is_document_copy_received) !== true ||
          asBoolean(row.is_aml_form_received) !== true ||
          asBoolean(row.is_uploaded_to_folder) !== true
      );
      reservationDocsPendingTotal = docsPendingRows.length;

      response.summary[4] = createSummaryCard(
        "reservations_active",
        "Reservas activas",
        activeReservations.length,
        "Embudo vivo de clientes",
        "/crm/clients/dashboard/",
        activeReservations.length > 0 ? "ok" : "neutral",
        true
      );
      response.reservations = {
        enabled: true,
        active_total: activeReservations.length,
        docs_pending_total: reservationDocsPendingTotal,
        status_breakdown: DASHBOARD_RESERVATION_STATUSES.map((status) => ({
          status,
          label: reservationStatusLabel(status),
          total: reservationRows.filter((row) => (asText(row.reservation_status) ?? "other") === status).length,
          is_active: RESERVATION_ACTIVE_STATUSES.has(status),
        })),
      };

    } catch (error) {
      if (!(error instanceof Error) || !isMissingRelationError(error, "client_project_reservations")) throw error;
    }
  }

  if (hasPermission(permissions, "crm.portal.read")) {
    try {
      const visitRows = await readAllPages(async (from, to) => {
        const { data, error } = await client
          .schema("crm")
          .from("portal_visit_requests")
          .select(VISIT_REQUEST_SELECT_COLUMNS)
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .range(from, to);
        return {
          data: (data ?? []) as Record<string, unknown>[],
          error: error ? { message: error.message, code: error.code, details: error.details } : null,
        };
      });

      const requestedRows = visitRows.filter((row) => asText(row.status) === "requested");
      requestedVisitsTotal = requestedRows.length;

      response.portal.visit_requests = {
        total: visitRows.length,
        requested: requestedRows.length,
        confirmed: visitRows.filter((row) => asText(row.status) === "confirmed").length,
        declined: visitRows.filter((row) => asText(row.status) === "declined").length,
        done: visitRows.filter((row) => asText(row.status) === "done").length,
        no_show: visitRows.filter((row) => asText(row.status) === "no_show").length,
        cancelled: visitRows.filter((row) => asText(row.status) === "cancelled").length,
      };
      hasPortalData = true;
    } catch (error) {
      if (!(error instanceof Error) || !isMissingRelationError(error, "portal_visit_requests")) throw error;
    }

    try {
      const commissionRows = await readAllPages(async (from, to) => {
        const { data, error } = await client
          .schema("crm")
          .from("portal_commission_status")
          .select(COMMISSION_SELECT_COLUMNS)
          .eq("organization_id", organizationId)
          .order("updated_at", { ascending: false })
          .range(from, to);
        return {
          data: (data ?? []) as Record<string, unknown>[],
          error: error ? { message: error.message, code: error.code, details: error.details } : null,
        };
      });

      const pendingRows = commissionRows.filter((row) => asText(row.status) === "pending");
      pendingCommissionsTotal = pendingRows.length;

      response.portal.commissions = {
        total: commissionRows.length,
        pending: pendingRows.length,
        approved: commissionRows.filter((row) => asText(row.status) === "approved").length,
        paid: commissionRows.filter((row) => asText(row.status) === "paid").length,
        cancelled: commissionRows.filter((row) => asText(row.status) === "cancelled").length,
      };
      hasPortalData = true;
    } catch (error) {
      if (!(error instanceof Error) || !isMissingRelationError(error, "portal_commission_status")) throw error;
    }

    if (hasPortalData) {
      response.portal.enabled = true;
      response.summary[5] = createSummaryCard(
        "portal_pending",
        "Portal pendiente",
        requestedVisitsTotal + pendingCommissionsTotal,
        "Visitas y comisiones por resolver",
        "/crm/portal/operations/",
        requestedVisitsTotal + pendingCommissionsTotal > 0 ? "warn" : "neutral",
        true
      );
    }
  }

  if (hasPermission(permissions, "crm.notifications.read")) {
    try {
      const notificationRows = persistedNotifications.length
        ? persistedNotifications
        : await readNotificationRows(client, organizationId, {
            includeClosed: false,
          });

      let pendingCount = 0;
      let scheduledCount = 0;
      let overdueCount = 0;

      notificationRows.forEach((row) => {
        const mapped = mapNotificationRow(row);
        const status = mapped.status;
        if (status === "pending") pendingCount += 1;
        if (status === "scheduled") scheduledCount += 1;
        if (mapped.is_overdue) overdueCount += 1;

        if (mapped.is_open) {
          const bucket = mapped.assigned_user_id && authUserId && mapped.assigned_user_id === authUserId ? "mine" : "team";
          (bucket === "mine" ? mineInbox : teamInbox).push({
            id: `notification:${mapped.id ?? Math.random().toString(36).slice(2)}`,
            kind: "notification_due",
            bucket,
            priority: mapped.is_overdue ? "urgent" : mapped.priority === "low" ? "normal" : mapped.priority,
            title: mapped.title ?? "Notificacion CRM",
            reason: mapped.is_overdue ? "Notificacion pendiente fuera de plazo" : "Seguimiento pendiente",
            age_label: formatAgeLabel(mapped.due_at ?? mapped.updated_at, nowMillis),
            href: mapped.lead_id
              ? `/crm/leads/${mapped.lead_id}/`
              : mapped.deal_id
                ? `/crm/deals/${mapped.deal_id}/`
                : mapped.client_id
                  ? `/crm/clients/${mapped.client_id}/`
                  : "/crm/notifications/",
            cta_label: mapped.lead_id ? "Abrir lead" : mapped.deal_id ? "Abrir deal" : mapped.client_id ? "Abrir cliente" : "Abrir notificaciones",
            entity_id: mapped.id,
            entity_type: "notification",
            date: mapped.due_at ?? mapped.updated_at,
            meta: [mapped.rule_key ?? null, mapped.entity_type ?? null].filter((entry): entry is string => Boolean(entry)),
          });
        }
      });

      response.notifications = {
        enabled: true,
        pending_count: pendingCount,
        scheduled_count: scheduledCount,
        overdue_count: overdueCount,
      };
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      if (isMissingNotificationOrchestrationColumnError(details) || isMissingRelationError(error, "notifications")) {
        throw new Error(`notifications_schema_incomplete:${details}`);
      }
      throw error;
    }
  }

  const sortedMine = sortInboxItems(mineInbox);
  const sortedTeam = sortInboxItems(teamInbox);
  response.inbox = {
    mine: sortedMine.slice(0, inboxLimit),
    team: sortedTeam.slice(0, inboxLimit),
    total_mine: sortedMine.length,
    total_team: sortedTeam.length,
  };

  const alerts: DashboardAlert[] = [];
  if (dealsAtRiskTotal > 0) {
    alerts.push({
      id: "deals_risk",
      tone: dealsAtRiskTotal >= 5 ? "danger" : "warn",
      title: "Deals en riesgo",
      message: `${dealsAtRiskTotal} deals abiertos con cierre vencido o sin fecha estimada.`,
      href: "/crm/deals/?only_open=1",
    });
  }
  if (reservationDocsPendingTotal > 0) {
    alerts.push({
      id: "reservation_docs_pending",
      tone: reservationDocsPendingTotal >= 5 ? "danger" : "warn",
      title: "Documentacion pendiente",
      message: `${reservationDocsPendingTotal} reservas activas requieren documentacion o subida a carpeta.`,
      href: "/crm/clients/dashboard/",
    });
  }
  if (requestedVisitsTotal > 0) {
    alerts.push({
      id: "portal_visits_pending",
      tone: requestedVisitsTotal >= 5 ? "danger" : "warn",
      title: "Visitas por confirmar",
      message: `${requestedVisitsTotal} solicitudes de visita siguen en estado requested.`,
      href: "/crm/portal/operations/",
    });
  }
  if (response.notifications.overdue_count > 0) {
    alerts.push({
      id: "notifications_overdue",
      tone: response.notifications.overdue_count >= 5 ? "danger" : "warn",
      title: "Notificaciones vencidas",
      message: `${response.notifications.overdue_count} recordatorios o avisos estan fuera de plazo.`,
      href: "/crm/notifications/",
    });
  }
  if (
    response.notifications.enabled &&
    mineInbox.length + teamInbox.length === 0 &&
    (dealsAtRiskTotal > 0 || reservationDocsPendingTotal > 0 || requestedVisitsTotal > 0)
  ) {
    alerts.push({
      id: "notifications_sync_hint",
      tone: "info",
      title: "Sin alertas persistidas abiertas",
      message: "El cockpit ya no inventa pendientes. Si esperabas trabajo sistemico, ejecuta sync en notificaciones.",
      href: "/crm/notifications/",
    });
  }

  response.alerts = alerts.slice(0, 4);
  return response;
};
