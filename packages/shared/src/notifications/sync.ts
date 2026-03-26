import { hydrateDealRows } from "../deals/crud.ts";
import { DEAL_SELECT_COLUMNS, isDealTerminalStage, normalizeDealStage } from "../deals/domain.ts";
import { buildLeadRows, CONTACT_SELECT_COLUMNS, LEAD_SELECT_COLUMNS } from "../leads/domain.ts";
import {
  mapNotificationRow,
  normalizeNotificationPriority,
  normalizeNotificationRuleKey,
  normalizeNotificationSourceType,
  normalizeNotificationStatus,
  NOTIFICATION_RULE_KEYS,
  NOTIFICATION_SELECT_COLUMNS,
  type NotificationPriority,
  type NotificationRuleKey,
} from "./domain.ts";
import {
  getDealOverduePriority,
  getDealStalledPriority,
  getDealStalledThresholdDays,
  getLeadNewUnworkedPriority,
  getLeadNoContactPriority,
  getReservationDocsPriority,
  LEAD_OPEN_NOTIFICATION_STATUSES,
  RESERVATION_ACTIVE_NOTIFICATION_STATUSES,
} from "./rules.ts";
import { asBoolean, asText, asUuid } from "../portal/domain.ts";
import { getProjectNameFromRow, getPropertyDisplayNameFromRow } from "../properties/domain.ts";

const PAGE_SIZE = 500;
const IN_QUERY_CHUNK_SIZE = 200;
const NOTIFICATION_OPEN_STATUSES = ["pending", "scheduled"] as const;
const CRM_ADMIN_ROLES = ["owner", "admin"] as const;

type QueryChunkResult = {
  data: Record<string, unknown>[] | null;
  error: { message: string; code?: string; details?: string } | null;
};

export type NotificationSyncScope = "all" | "leads" | "deals" | "reservations";

export type NotificationSyncOptions = {
  scope?: NotificationSyncScope | null;
  onlyRule?: NotificationRuleKey | null;
  dryRun?: boolean;
  limit?: number | null;
};

export type NotificationSyncResult = {
  organization_id: string;
  scope: NotificationSyncScope;
  only_rule: NotificationRuleKey | null;
  dry_run: boolean;
  desired_total: number;
  created: number;
  updated: number;
  resolved: number;
  unchanged: number;
  skipped_existing_manual: number;
  samples: Array<{
    action: "create" | "update" | "resolve" | "unchanged";
    rule_hash: string;
    title: string;
    priority: NotificationPriority;
  }>;
};

type DesiredSystemNotification = {
  source_type: "system";
  notification_type: "system_alert";
  channel: "in_app";
  status: "pending";
  priority: NotificationPriority;
  rule_key: NotificationRuleKey;
  rule_hash: string;
  entity_type: "lead" | "deal" | "reservation";
  title: string;
  body: string;
  assigned_user_id: string | null;
  manager_user_id: string | null;
  assignee_email: string | null;
  lead_id: string | null;
  client_id: string | null;
  deal_id: string | null;
  reservation_id: string | null;
  project_property_id: string | null;
  due_at: string | null;
  snoozed_until: null;
  metadata: Record<string, unknown>;
};

type NotificationReadInput = {
  sourceType?: string | null;
  ruleKey?: string | null;
  entityType?: string | null;
  leadId?: string | null;
  dealId?: string | null;
  clientId?: string | null;
  reservationId?: string | null;
  assignedUserId?: string | null;
  managerUserId?: string | null;
  statuses?: string[] | null;
  includeClosed?: boolean;
};

const dedupeUuids = (values: Array<string | null | undefined>) =>
  Array.from(new Set(values.map((value) => asUuid(value ?? null)).filter((value): value is string => Boolean(value))));

const readAllPages = async (
  loader: (from: number, to: number) => Promise<QueryChunkResult>,
  pageSize = PAGE_SIZE
): Promise<Record<string, unknown>[]> => {
  const rows: Record<string, unknown>[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await loader(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
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
    table: "contacts" | "clients" | "properties";
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

const PROPERTY_SELECT_COLUMNS = [
  "id",
  "legacy_code",
  "translations",
  "property_data",
  "parent_property_id",
  "record_type",
  "status",
].join(", ");

const RESERVATION_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "client_id",
  "project_property_id",
  "reservation_status",
  "is_document_copy_received",
  "is_aml_form_received",
  "is_uploaded_to_folder",
  "created_at",
  "updated_at",
].join(", ");

const CLIENT_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "contact_id",
  "client_code",
  "client_status",
  "billing_name",
].join(", ");

const readPropertiesWithParentsByIds = async (client: any, organizationId: string, ids: string[]) => {
  const direct = await readRowsByIds(client, organizationId, {
    table: "properties",
    select: PROPERTY_SELECT_COLUMNS,
    ids,
    errorPrefix: "db_properties_read_error",
  });
  const parentIds = dedupeUuids(Array.from(direct.values()).map((row) => asText(row.parent_property_id)));
  if (!parentIds.length) return direct;

  const parents = await readRowsByIds(client, organizationId, {
    table: "properties",
    select: PROPERTY_SELECT_COLUMNS,
    ids: parentIds,
    errorPrefix: "db_properties_parent_read_error",
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

const hoursSince = (value: unknown, nowMillis: number) => {
  const millis = toMillis(value);
  if (millis == null) return null;
  return (nowMillis - millis) / 3600000;
};

const daysSince = (value: unknown, nowMillis: number) => {
  const hours = hoursSince(value, nowMillis);
  return hours == null ? null : Math.floor(hours / 24);
};

const addHoursIso = (value: unknown, hours: number): string | null => {
  const millis = toMillis(value);
  if (millis == null) return null;
  return new Date(millis + hours * 3600000).toISOString();
};

const addDaysIso = (value: unknown, days: number): string | null => addHoursIso(value, days * 24);

const startOfTodayMillis = (now: Date) => {
  const next = new Date(now);
  next.setHours(0, 0, 0, 0);
  return next.getTime();
};

const normalizeScope = (value: unknown): NotificationSyncScope => {
  return value === "leads" || value === "deals" || value === "reservations" ? value : "all";
};

const pickManagerUserId = (assignedUserId: string | null, managerIds: string[]) => {
  const preferred = managerIds.find((entry) => entry !== assignedUserId);
  return preferred ?? managerIds[0] ?? null;
};

const createRuleHash = (ruleKey: NotificationRuleKey, entityId: string, suffix?: string | null) =>
  `${ruleKey}:${entityId}${suffix ? `:${suffix}` : ""}`;

const includeRule = (ruleKey: NotificationRuleKey, options: NotificationSyncOptions) => {
  if (options.onlyRule) return options.onlyRule === ruleKey;
  return true;
};

export const isMissingNotificationOrchestrationColumnError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("column notifications.source_type does not exist") ||
    message.includes("column notifications.rule_key does not exist") ||
    message.includes("column notifications.rule_hash does not exist") ||
    message.includes("column notifications.entity_type does not exist") ||
    message.includes("column notifications.assigned_user_id does not exist")
  );
};

export const readNotificationRows = async (
  client: any,
  organizationId: string,
  input: NotificationReadInput = {}
) => {
  let query = client
    .schema("crm")
    .from("notifications")
    .select(NOTIFICATION_SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (input.sourceType) query = query.eq("source_type", normalizeNotificationSourceType(input.sourceType));
  if (input.ruleKey) query = query.eq("rule_key", input.ruleKey);
  if (input.entityType) query = query.eq("entity_type", input.entityType);
  if (input.leadId) query = query.eq("lead_id", input.leadId);
  if (input.dealId) query = query.eq("deal_id", input.dealId);
  if (input.clientId) query = query.eq("client_id", input.clientId);
  if (input.reservationId) query = query.eq("reservation_id", input.reservationId);
  if (input.assignedUserId) query = query.eq("assigned_user_id", input.assignedUserId);
  if (input.managerUserId) query = query.eq("manager_user_id", input.managerUserId);
  if (Array.isArray(input.statuses) && input.statuses.length) query = query.in("status", input.statuses);
  else if (!input.includeClosed) query = query.in("status", [...NOTIFICATION_OPEN_STATUSES]);

  const { data, error } = await query;
  if (error) throw new Error(`db_notifications_read_error:${error.message}`);
  return (data ?? []) as Record<string, unknown>[];
};

const readManagerUserIds = async (client: any, organizationId: string) => {
  const { data, error } = await client
    .schema("crm")
    .from("memberships")
    .select("user_id, role")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .in("role", [...CRM_ADMIN_ROLES]);

  if (error) throw new Error(`db_memberships_read_error:${error.message}`);
  return dedupeUuids((data ?? []).map((row: Record<string, unknown>) => asText(row.user_id)));
};

const buildLeadNotifications = async (
  client: any,
  organizationId: string,
  managerIds: string[],
  now: Date,
  options: NotificationSyncOptions
): Promise<DesiredSystemNotification[]> => {
  if (options.scope && options.scope !== "all" && options.scope !== "leads") return [];

  const leadRows = await readAllPages(async (from, to) => {
    const { data, error } = await client
      .schema("crm")
      .from("leads")
      .select(LEAD_SELECT_COLUMNS)
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .range(from, to);
    return { data: (data ?? []) as Record<string, unknown>[], error: error ? { message: error.message } : null };
  });

  const contactIds = dedupeUuids(leadRows.map((row) => asText(row.contact_id)));
  const propertyIds = dedupeUuids(leadRows.map((row) => asText(row.property_id)));
  const [contactsById, propertiesById] = await Promise.all([
    readRowsByIds(client, organizationId, {
      table: "contacts",
      select: CONTACT_SELECT_COLUMNS,
      ids: contactIds,
      errorPrefix: "db_contacts_read_error",
    }),
    readPropertiesWithParentsByIds(client, organizationId, propertyIds),
  ]);

  const leads = buildLeadRows(leadRows, contactsById, propertiesById);
  const nowMillis = now.getTime();
  const desired: DesiredSystemNotification[] = [];

  for (const lead of leads) {
    if (!lead.id || !LEAD_OPEN_NOTIFICATION_STATUSES.has(String(lead.status ?? ""))) continue;
    const staleHours = hoursSince(lead.updated_at, nowMillis) ?? 0;
    const staleDays = daysSince(lead.updated_at, nowMillis) ?? 0;
    const baseTitle = lead.full_name ?? lead.email ?? lead.phone ?? lead.id ?? "Lead";
    const propertyLabel = lead.project_label ?? lead.property_label ?? lead.property_code ?? null;
    const managerUserId = pickManagerUserId(lead.assigned_to, managerIds);

    if (includeRule("lead_new_unworked", options) && lead.status === "new" && staleHours > 24) {
      const priority = getLeadNewUnworkedPriority(staleHours);
      desired.push({
        source_type: "system",
        notification_type: "system_alert",
        channel: "in_app",
        status: "pending",
        priority,
        rule_key: "lead_new_unworked",
        rule_hash: createRuleHash("lead_new_unworked", lead.id),
        entity_type: "lead",
        title: `${baseTitle} | lead nuevo sin trabajar`,
        body: `Lead nuevo sin gestionar desde hace ${Math.max(1, Math.floor(staleHours))} horas.`,
        assigned_user_id: lead.assigned_to,
        manager_user_id: staleHours > 72 ? managerUserId : null,
        assignee_email: null,
        lead_id: lead.id,
        client_id: lead.converted_client_id ?? null,
        deal_id: null,
        reservation_id: null,
        project_property_id: lead.property_id,
        due_at: addHoursIso(lead.updated_at, 24),
        snoozed_until: null,
        metadata: {
          project_label: propertyLabel,
          lead_status: lead.status,
          source: lead.source,
          stale_hours: Math.floor(staleHours),
        },
      });
    }

    if (includeRule("lead_no_contact_22d", options) && staleDays >= 22) {
      desired.push({
        source_type: "system",
        notification_type: "system_alert",
        channel: "in_app",
        status: "pending",
        priority: getLeadNoContactPriority(staleDays),
        rule_key: "lead_no_contact_22d",
        rule_hash: createRuleHash("lead_no_contact_22d", lead.id),
        entity_type: "lead",
        title: `${baseTitle} | 22 dias sin contacto`,
        body: `Lead sin actualizar desde hace ${staleDays} dias. Requiere intervencion prioritaria.`,
        assigned_user_id: lead.assigned_to,
        manager_user_id: managerUserId,
        assignee_email: null,
        lead_id: lead.id,
        client_id: lead.converted_client_id ?? null,
        deal_id: null,
        reservation_id: null,
        project_property_id: lead.property_id,
        due_at: addDaysIso(lead.updated_at, 22),
        snoozed_until: null,
        metadata: {
          project_label: propertyLabel,
          lead_status: lead.status,
          source: lead.source,
          stale_days: staleDays,
        },
      });
    } else if (includeRule("lead_no_contact_7d", options) && staleDays >= 7) {
      desired.push({
        source_type: "system",
        notification_type: "system_alert",
        channel: "in_app",
        status: "pending",
        priority: getLeadNoContactPriority(staleDays),
        rule_key: "lead_no_contact_7d",
        rule_hash: createRuleHash("lead_no_contact_7d", lead.id),
        entity_type: "lead",
        title: `${baseTitle} | 7 dias sin contacto`,
        body: `Lead sin actualizar desde hace ${staleDays} dias.`,
        assigned_user_id: lead.assigned_to,
        manager_user_id: staleDays >= 14 ? managerUserId : null,
        assignee_email: null,
        lead_id: lead.id,
        client_id: lead.converted_client_id ?? null,
        deal_id: null,
        reservation_id: null,
        project_property_id: lead.property_id,
        due_at: addDaysIso(lead.updated_at, 7),
        snoozed_until: null,
        metadata: {
          project_label: propertyLabel,
          lead_status: lead.status,
          source: lead.source,
          stale_days: staleDays,
        },
      });
    }
  }

  return desired;
};

const buildDealNotifications = async (
  client: any,
  organizationId: string,
  managerIds: string[],
  now: Date,
  options: NotificationSyncOptions
): Promise<DesiredSystemNotification[]> => {
  if (options.scope && options.scope !== "all" && options.scope !== "deals") return [];

  const dealRows = await readAllPages(async (from, to) => {
    const { data, error } = await client
      .schema("crm")
      .from("deals")
      .select(DEAL_SELECT_COLUMNS)
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .range(from, to);
    return { data: (data ?? []) as Record<string, unknown>[], error: error ? { message: error.message } : null };
  });

  const deals = await hydrateDealRows(client, organizationId, dealRows);
  const desired: DesiredSystemNotification[] = [];
  const nowMillis = now.getTime();
  const todayStart = startOfTodayMillis(now);

  for (const deal of deals) {
    if (!deal.id || isDealTerminalStage(deal.stage)) continue;
    const managerUserId = pickManagerUserId(deal.owner_id, managerIds);
    const propertyLabel = deal.property?.display_name ?? deal.property?.project_label ?? deal.property?.legacy_code ?? null;
    const clientLabel = deal.client?.full_name ?? deal.client?.client_code ?? null;

    const expectedMillis = toDateOnlyMillis(deal.expected_close_date);
    if (includeRule("deal_overdue", options) && expectedMillis != null && expectedMillis < todayStart) {
      const daysLate = Math.max(1, daysSince(deal.expected_close_date, nowMillis) ?? 1);
      desired.push({
        source_type: "system",
        notification_type: "system_alert",
        channel: "in_app",
        status: "pending",
        priority: getDealOverduePriority(daysLate),
        rule_key: "deal_overdue",
        rule_hash: createRuleHash("deal_overdue", deal.id),
        entity_type: "deal",
        title: `${deal.title ?? deal.id} | cierre vencido`,
        body: `El deal tiene la fecha estimada de cierre vencida hace ${daysLate} dias.`,
        assigned_user_id: deal.owner_id,
        manager_user_id: daysLate > 7 ? managerUserId : null,
        assignee_email: null,
        lead_id: deal.lead_id,
        client_id: deal.client_id,
        deal_id: deal.id,
        reservation_id: null,
        project_property_id: deal.property_id,
        due_at: deal.expected_close_date ? `${deal.expected_close_date}T00:00:00.000Z` : null,
        snoozed_until: null,
        metadata: {
          client_label: clientLabel,
          property_label: propertyLabel,
          stage: deal.stage,
          days_late: daysLate,
        },
      });
      continue;
    }

    if (includeRule("deal_stalled", options)) {
      const normalizedStage = normalizeDealStage(deal.stage);
      const thresholdDays = getDealStalledThresholdDays(normalizedStage);
      const staleDays = daysSince(deal.updated_at, nowMillis) ?? 0;
      if (staleDays > thresholdDays) {
        desired.push({
          source_type: "system",
          notification_type: "system_alert",
          channel: "in_app",
          status: "pending",
          priority: getDealStalledPriority(normalizedStage),
          rule_key: "deal_stalled",
          rule_hash: createRuleHash("deal_stalled", deal.id, String(deal.stage)),
          entity_type: "deal",
          title: `${deal.title ?? deal.id} | deal atascado`,
          body: `El deal no cambia desde hace ${staleDays} dias en fase ${deal.stage}.`,
          assigned_user_id: deal.owner_id,
          manager_user_id: staleDays > thresholdDays * 2 ? managerUserId : null,
          assignee_email: null,
          lead_id: deal.lead_id,
          client_id: deal.client_id,
          deal_id: deal.id,
          reservation_id: null,
          project_property_id: deal.property_id,
          due_at: addDaysIso(deal.updated_at, thresholdDays),
          snoozed_until: null,
          metadata: {
            client_label: clientLabel,
            property_label: propertyLabel,
            stage: deal.stage,
            stale_days: staleDays,
            threshold_days: thresholdDays,
          },
        });
      }
    }
  }

  return desired;
};

const buildReservationNotifications = async (
  client: any,
  organizationId: string,
  managerIds: string[],
  now: Date,
  options: NotificationSyncOptions
): Promise<DesiredSystemNotification[]> => {
  if (options.scope && options.scope !== "all" && options.scope !== "reservations") return [];
  if (!includeRule("reservation_docs_missing", options)) return [];

  const rows = await readAllPages(async (from, to) => {
    const { data, error } = await client
      .schema("crm")
      .from("client_project_reservations")
      .select(RESERVATION_SELECT_COLUMNS)
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .range(from, to);
    return { data: (data ?? []) as Record<string, unknown>[], error: error ? { message: error.message } : null };
  });

  const activeRows = rows.filter((row) =>
    RESERVATION_ACTIVE_NOTIFICATION_STATUSES.has(asText(row.reservation_status) ?? "other")
  );
  const docsMissingRows = activeRows.filter(
    (row) =>
      asBoolean(row.is_document_copy_received) !== true ||
      asBoolean(row.is_aml_form_received) !== true ||
      asBoolean(row.is_uploaded_to_folder) !== true
  );

  const clientIds = dedupeUuids(docsMissingRows.map((row) => asText(row.client_id)));
  const projectIds = dedupeUuids(docsMissingRows.map((row) => asText(row.project_property_id)));
  const [clientsById, projectsById] = await Promise.all([
    readRowsByIds(client, organizationId, {
      table: "clients",
      select: CLIENT_SELECT_COLUMNS,
      ids: clientIds,
      errorPrefix: "db_clients_read_error",
    }),
    readPropertiesWithParentsByIds(client, organizationId, projectIds),
  ]);
  const contactIds = dedupeUuids(Array.from(clientsById.values()).map((row) => asText(row.contact_id)));
  const contactsById = await readRowsByIds(client, organizationId, {
    table: "contacts",
    select: CONTACT_SELECT_COLUMNS,
    ids: contactIds,
    errorPrefix: "db_contacts_read_error",
  });

  const nowMillis = now.getTime();
  const managerUserId = managerIds[0] ?? null;
  const desired: DesiredSystemNotification[] = [];

  for (const row of docsMissingRows) {
    const reservationId = asUuid(row.id);
    const clientId = asUuid(row.client_id);
    if (!reservationId) continue;
    const clientRow = clientId ? clientsById.get(clientId) ?? null : null;
    const contactId = clientRow ? asUuid(clientRow.contact_id) : null;
    const contactRow = contactId ? contactsById.get(contactId) ?? null : null;
    const projectId = asUuid(row.project_property_id);
    const projectRow = projectId ? projectsById.get(projectId) ?? null : null;
    const status = asText(row.reservation_status);
    const staleDays = daysSince(row.updated_at, nowMillis) ?? 0;
    const clientLabel =
      asText(contactRow?.full_name) ?? asText(clientRow?.billing_name) ?? asText(clientRow?.client_code) ?? "Cliente";
    const projectLabel = projectRow ? getProjectNameFromRow(projectRow) ?? getPropertyDisplayNameFromRow(projectRow) : null;
    const priority = getReservationDocsPriority(status);

    desired.push({
      source_type: "system",
      notification_type: "system_alert",
      channel: "in_app",
      status: "pending",
      priority,
      rule_key: "reservation_docs_missing",
      rule_hash: createRuleHash("reservation_docs_missing", reservationId),
      entity_type: "reservation",
      title: projectLabel ? `${clientLabel} | docs pendientes` : `${clientLabel} | reserva activa`,
      body: "Reserva activa con documentacion pendiente o subida a carpeta incompleta.",
      assigned_user_id: null,
      manager_user_id:
        (status === "reserved" || status === "adhesion_paid" || status === "contract_signed") && staleDays > 5
          ? managerUserId
          : null,
      assignee_email: null,
      lead_id: null,
      client_id: clientId,
      deal_id: null,
      reservation_id: reservationId,
      project_property_id: projectId,
      due_at:
        status === "reserved" || status === "adhesion_paid" || status === "contract_signed"
          ? addDaysIso(row.updated_at, 1)
          : addDaysIso(row.updated_at, 2),
      snoozed_until: null,
      metadata: {
        client_label: clientLabel,
        project_label: projectLabel,
        reservation_status: status,
        is_document_copy_received: asBoolean(row.is_document_copy_received),
        is_aml_form_received: asBoolean(row.is_aml_form_received),
        is_uploaded_to_folder: asBoolean(row.is_uploaded_to_folder),
      },
    });
  }

  return desired;
};

const filterDesiredRows = (rows: DesiredSystemNotification[], options: NotificationSyncOptions) => {
  if (!Number.isFinite(options.limit) || Number(options.limit) <= 0) return rows;
  return rows.slice(0, Math.floor(Number(options.limit)));
};

const buildUpsertPayload = (desired: DesiredSystemNotification) => ({
  notification_type: desired.notification_type,
  channel: desired.channel,
  priority: desired.priority,
  status: desired.status,
  source_type: desired.source_type,
  rule_key: desired.rule_key,
  rule_hash: desired.rule_hash,
  entity_type: desired.entity_type,
  title: desired.title,
  body: desired.body,
  assignee_email: desired.assignee_email,
  assigned_user_id: desired.assigned_user_id,
  manager_user_id: desired.manager_user_id,
  lead_id: desired.lead_id,
  client_id: desired.client_id,
  deal_id: desired.deal_id,
  reservation_id: desired.reservation_id,
  project_property_id: desired.project_property_id,
  due_at: desired.due_at,
  snoozed_until: desired.snoozed_until,
  metadata: desired.metadata,
});

const changedPayload = (existingRow: Record<string, unknown>, desired: DesiredSystemNotification) => {
  const patch = buildUpsertPayload(desired);
  const nextPatch: Record<string, unknown> = {};
  Object.entries(patch).forEach(([key, value]) => {
    const current = existingRow[key];
    if (JSON.stringify(current ?? null) !== JSON.stringify(value ?? null)) nextPatch[key] = value;
  });
  return nextPatch;
};

export const syncNotificationsForOrganization = async (
  client: any,
  organizationId: string,
  input: NotificationSyncOptions = {}
): Promise<NotificationSyncResult> => {
  const scope = normalizeScope(input.scope);
  const onlyRule = normalizeNotificationRuleKey(input.onlyRule);
  const dryRun = input.dryRun === true;
  const now = new Date();
  const managerIds = await readManagerUserIds(client, organizationId);

  const desiredRows = filterDesiredRows(
    [
      ...(await buildLeadNotifications(client, organizationId, managerIds, now, { ...input, scope, onlyRule })),
      ...(await buildDealNotifications(client, organizationId, managerIds, now, { ...input, scope, onlyRule })),
      ...(await buildReservationNotifications(client, organizationId, managerIds, now, { ...input, scope, onlyRule })),
    ],
    input
  );

  const relevantRuleKeys = new Set(
    (onlyRule ? [onlyRule] : [...NOTIFICATION_RULE_KEYS]).filter((value) => {
      if (scope === "leads") return value.startsWith("lead_");
      if (scope === "deals") return value.startsWith("deal_");
      if (scope === "reservations") return value.startsWith("reservation_");
      return true;
    })
  );

  let existingRows: Record<string, unknown>[] = [];
  try {
    existingRows = await readNotificationRows(client, organizationId, {
      sourceType: "system",
      includeClosed: true,
    });
  } catch (error) {
    if (!(dryRun && isMissingNotificationOrchestrationColumnError(error))) {
      throw error;
    }
  }

  const existingByRuleHash = new Map(
    existingRows
      .map((row) => [asText(row.rule_hash), row] as const)
      .filter((entry): entry is [string, Record<string, unknown>] => Boolean(entry[0]))
  );

  let created = 0;
  let updated = 0;
  let resolved = 0;
  let unchanged = 0;
  let skippedExistingManual = 0;
  const samples: NotificationSyncResult["samples"] = [];

  for (const desired of desiredRows) {
    const existing = existingByRuleHash.get(desired.rule_hash) ?? null;
    if (!existing) {
      if (!dryRun) {
        const { error } = await client.schema("crm").from("notifications").insert({
          organization_id: organizationId,
          ...buildUpsertPayload(desired),
        });
        if (error) throw new Error(`db_notifications_insert_error:${error.message}`);
      }
      created += 1;
      if (samples.length < 30) samples.push({ action: "create", rule_hash: desired.rule_hash, title: desired.title, priority: desired.priority });
      continue;
    }

    if (normalizeNotificationSourceType(existing.source_type) === "manual") {
      skippedExistingManual += 1;
      continue;
    }

    const patch = changedPayload(existing, desired);
    if (!Object.keys(patch).length) {
      unchanged += 1;
      if (samples.length < 30) samples.push({ action: "unchanged", rule_hash: desired.rule_hash, title: desired.title, priority: desired.priority });
      continue;
    }

    if (!dryRun) {
      const { error } = await client.schema("crm").from("notifications").update(patch).eq("organization_id", organizationId).eq("id", existing.id);
      if (error) throw new Error(`db_notifications_update_error:${error.message}`);
    }
    updated += 1;
    if (samples.length < 30) samples.push({ action: "update", rule_hash: desired.rule_hash, title: desired.title, priority: desired.priority });
  }

  const desiredHashes = new Set(desiredRows.map((row) => row.rule_hash));
  const rowsToResolve = existingRows.filter((row) => {
    const ruleHash = asText(row.rule_hash);
    const ruleKey = normalizeNotificationRuleKey(row.rule_key);
    const status = normalizeNotificationStatus(row.status);
    return Boolean(ruleHash && ruleKey && relevantRuleKeys.has(ruleKey) && NOTIFICATION_OPEN_STATUSES.includes(status) && !desiredHashes.has(ruleHash));
  });

  for (const row of rowsToResolve) {
    if (!dryRun) {
      const { error } = await client
        .schema("crm")
        .from("notifications")
        .update({
          status: "done",
          resolved_at: now.toISOString(),
          resolution_note: "auto_resolved_by_sync",
        })
        .eq("organization_id", organizationId)
        .eq("id", row.id);
      if (error) throw new Error(`db_notifications_resolve_error:${error.message}`);
    }
    resolved += 1;
    if (samples.length < 30) {
      samples.push({
        action: "resolve",
        rule_hash: asText(row.rule_hash) ?? "unknown",
        title: asText(row.title) ?? "Notificacion",
        priority: normalizeNotificationPriority(row.priority),
      });
    }
  }

  return {
    organization_id: organizationId,
    scope,
    only_rule: onlyRule,
    dry_run: dryRun,
    desired_total: desiredRows.length,
    created,
    updated,
    resolved,
    unchanged,
    skipped_existing_manual: skippedExistingManual,
    samples,
  };
};

export const buildNotificationEntitySummary = (rows: Array<Record<string, unknown>>) => {
  const mapped = rows.map((row) => mapNotificationRow(row));
  const active = mapped.filter((row) => row.is_open);
  const priorityRank: Record<NotificationPriority, number> = {
    low: 1,
    normal: 2,
    high: 3,
    urgent: 4,
  };
  const maxPriority =
    active
      .slice()
      .sort((left, right) => (priorityRank[right.priority] ?? 0) - (priorityRank[left.priority] ?? 0))
      .at(0)?.priority ?? null;
  return {
    total: mapped.length,
    open_total: active.length,
    overdue_total: active.filter((row) => row.is_overdue).length,
    urgent_total: active.filter((row) => row.priority === "urgent").length,
    high_total: active.filter((row) => row.priority === "high").length,
    max_priority: maxPriority,
    active_notifications: active.slice(0, 5),
    recent_notifications: mapped.slice(0, 5),
  };
};
