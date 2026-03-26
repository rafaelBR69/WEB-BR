import { asObject, asText, asUuid } from "../portal/domain.ts";

export const NOTIFICATION_TYPES = [
  "in_app_message",
  "email_outreach",
  "lead_follow_up",
  "call_reminder",
  "system_alert",
] as const;

export const NOTIFICATION_CHANNELS = ["in_app", "email", "whatsapp", "phone"] as const;
export const NOTIFICATION_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const NOTIFICATION_STATUSES = ["pending", "scheduled", "sent", "done", "cancelled", "failed"] as const;
export const NOTIFICATION_SOURCE_TYPES = ["manual", "system"] as const;
export const NOTIFICATION_ENTITY_TYPES = ["lead", "deal", "client", "reservation", "generic"] as const;
export const NOTIFICATION_RULE_KEYS = [
  "lead_new_unworked",
  "lead_no_contact_7d",
  "lead_no_contact_22d",
  "deal_overdue",
  "deal_stalled",
  "reservation_docs_missing",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
export type NotificationSourceType = (typeof NOTIFICATION_SOURCE_TYPES)[number];
export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number];
export type NotificationRuleKey = (typeof NOTIFICATION_RULE_KEYS)[number];

export const OPEN_NOTIFICATION_STATUSES = new Set<NotificationStatus>(["pending", "scheduled"]);

export const NOTIFICATION_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "notification_type",
  "channel",
  "priority",
  "status",
  "source_type",
  "rule_key",
  "rule_hash",
  "entity_type",
  "title",
  "body",
  "recipient_email",
  "recipient_phone",
  "assignee_email",
  "assigned_user_id",
  "manager_user_id",
  "lead_id",
  "client_id",
  "deal_id",
  "reservation_id",
  "project_property_id",
  "due_at",
  "scheduled_for",
  "sent_at",
  "completed_at",
  "read_at",
  "acknowledged_at",
  "snoozed_until",
  "escalated_at",
  "resolved_at",
  "resolution_note",
  "metadata",
  "created_by",
  "created_at",
  "updated_at",
].join(", ");

export const NOTIFICATION_LIST_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "notification_type",
  "channel",
  "priority",
  "status",
  "source_type",
  "rule_key",
  "entity_type",
  "title",
  "assignee_email",
  "assigned_user_id",
  "manager_user_id",
  "lead_id",
  "client_id",
  "deal_id",
  "reservation_id",
  "due_at",
  "read_at",
  "acknowledged_at",
  "created_at",
].join(", ");

export type NotificationListItem = {
  id: string | null;
  organization_id: string | null;
  notification_type: NotificationType;
  channel: NotificationChannel;
  priority: NotificationPriority;
  status: NotificationStatus;
  source_type: NotificationSourceType;
  rule_key: NotificationRuleKey | null;
  entity_type: NotificationEntityType;
  title: string | null;
  assignee_email: string | null;
  assigned_user_id: string | null;
  manager_user_id: string | null;
  lead_id: string | null;
  client_id: string | null;
  deal_id: string | null;
  reservation_id: string | null;
  due_at: string | null;
  read_at: string | null;
  acknowledged_at: string | null;
  created_at: string | null;
  is_open: boolean;
  is_overdue: boolean;
};

export type NotificationDetail = ReturnType<typeof mapNotificationRow>;

export type NotificationSummary = {
  total: number;
  open_total: number;
  pending_total: number;
  scheduled_total: number;
  overdue_total: number;
  urgent_total: number;
  high_total: number;
  max_priority: NotificationPriority | null;
  active: Array<Record<string, unknown>>;
  recent: Array<Record<string, unknown>>;
};

const PRIORITY_RANK: Record<NotificationPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

export const normalizeNotificationType = (value: unknown): NotificationType => {
  return NOTIFICATION_TYPES.includes(value as NotificationType) ? (value as NotificationType) : "in_app_message";
};

export const normalizeNotificationChannel = (value: unknown): NotificationChannel => {
  return NOTIFICATION_CHANNELS.includes(value as NotificationChannel) ? (value as NotificationChannel) : "in_app";
};

export const normalizeNotificationPriority = (value: unknown): NotificationPriority => {
  return NOTIFICATION_PRIORITIES.includes(value as NotificationPriority) ? (value as NotificationPriority) : "normal";
};

export const normalizeNotificationStatus = (value: unknown): NotificationStatus => {
  return NOTIFICATION_STATUSES.includes(value as NotificationStatus) ? (value as NotificationStatus) : "pending";
};

export const normalizeNotificationSourceType = (value: unknown): NotificationSourceType => {
  return NOTIFICATION_SOURCE_TYPES.includes(value as NotificationSourceType) ? (value as NotificationSourceType) : "manual";
};

export const normalizeNotificationEntityType = (value: unknown): NotificationEntityType => {
  return NOTIFICATION_ENTITY_TYPES.includes(value as NotificationEntityType) ? (value as NotificationEntityType) : "generic";
};

export const normalizeNotificationRuleKey = (value: unknown): NotificationRuleKey | null => {
  return NOTIFICATION_RULE_KEYS.includes(value as NotificationRuleKey) ? (value as NotificationRuleKey) : null;
};

export const isNotificationOpen = (value: unknown): boolean => {
  return OPEN_NOTIFICATION_STATUSES.has(normalizeNotificationStatus(value));
};

export const isNotificationOverdue = (row: Record<string, unknown>, nowMillis = Date.now()): boolean => {
  if (!isNotificationOpen(row.status)) return false;
  const dueAt = asText(row.due_at);
  if (!dueAt) return false;
  const dueMillis = new Date(dueAt).getTime();
  if (!Number.isFinite(dueMillis)) return false;
  const snoozedUntil = asText(row.snoozed_until);
  if (snoozedUntil) {
    const snoozedMillis = new Date(snoozedUntil).getTime();
    if (Number.isFinite(snoozedMillis) && snoozedMillis > nowMillis) return false;
  }
  return dueMillis <= nowMillis;
};

export const getNotificationPriorityRank = (value: unknown): number => {
  return PRIORITY_RANK[normalizeNotificationPriority(value)];
};

export const sortNotifications = (rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> => {
  return [...rows].sort((left, right) => {
    const priorityDelta = getNotificationPriorityRank(right.priority) - getNotificationPriorityRank(left.priority);
    if (priorityDelta !== 0) return priorityDelta;
    const leftDue = new Date(asText(left.due_at) ?? asText(left.updated_at) ?? 0).getTime();
    const rightDue = new Date(asText(right.due_at) ?? asText(right.updated_at) ?? 0).getTime();
    if (Number.isFinite(leftDue) && Number.isFinite(rightDue) && leftDue !== rightDue) return leftDue - rightDue;
    return String(asText(left.title) ?? "").localeCompare(String(asText(right.title) ?? ""), "es");
  });
};

export const mapNotificationRow = (row: Record<string, unknown>) => {
  const metadata = asObject(row.metadata);
  const priority = normalizeNotificationPriority(row.priority);
  const status = normalizeNotificationStatus(row.status);
  const sourceType = normalizeNotificationSourceType(row.source_type);
  const entityType = normalizeNotificationEntityType(row.entity_type);
  const ruleKey = normalizeNotificationRuleKey(row.rule_key);

  return {
    id: asUuid(row.id),
    organization_id: asUuid(row.organization_id),
    notification_type: normalizeNotificationType(row.notification_type),
    channel: normalizeNotificationChannel(row.channel),
    priority,
    status,
    source_type: sourceType,
    rule_key: ruleKey,
    rule_hash: asText(row.rule_hash),
    entity_type: entityType,
    title: asText(row.title),
    body: asText(row.body),
    recipient_email: asText(row.recipient_email),
    recipient_phone: asText(row.recipient_phone),
    assignee_email: asText(row.assignee_email),
    assigned_user_id: asUuid(row.assigned_user_id),
    manager_user_id: asUuid(row.manager_user_id),
    lead_id: asUuid(row.lead_id),
    client_id: asUuid(row.client_id),
    deal_id: asUuid(row.deal_id),
    reservation_id: asUuid(row.reservation_id),
    project_property_id: asUuid(row.project_property_id),
    due_at: asText(row.due_at),
    scheduled_for: asText(row.scheduled_for),
    sent_at: asText(row.sent_at),
    completed_at: asText(row.completed_at),
    read_at: asText(row.read_at),
    acknowledged_at: asText(row.acknowledged_at),
    snoozed_until: asText(row.snoozed_until),
    escalated_at: asText(row.escalated_at),
    resolved_at: asText(row.resolved_at),
    resolution_note: asText(row.resolution_note),
    metadata,
    created_by: asUuid(row.created_by),
    created_at: asText(row.created_at),
    updated_at: asText(row.updated_at),
    is_open: isNotificationOpen(status),
    is_overdue: isNotificationOverdue(row),
  };
};

export const summarizeNotificationRows = (
  rows: Array<Record<string, unknown>>,
  options: { activeLimit?: number; recentLimit?: number } = {}
): NotificationSummary => {
  const activeLimit = Number.isFinite(options.activeLimit) ? Math.max(1, Math.floor(Number(options.activeLimit))) : 5;
  const recentLimit = Number.isFinite(options.recentLimit) ? Math.max(1, Math.floor(Number(options.recentLimit))) : 5;
  const mapped = rows.map((row) => mapNotificationRow(row));
  const active = sortNotifications(mapped.filter((row) => row.is_open)).slice(0, activeLimit);
  const recent = sortNotifications(mapped).slice(0, recentLimit);
  const maxPriority = mapped.reduce<NotificationPriority | null>((best, row) => {
    if (!row.is_open) return best;
    if (!best) return row.priority;
    return getNotificationPriorityRank(row.priority) > getNotificationPriorityRank(best) ? row.priority : best;
  }, null);

  return {
    total: mapped.length,
    open_total: mapped.filter((row) => row.is_open).length,
    pending_total: mapped.filter((row) => row.status === "pending").length,
    scheduled_total: mapped.filter((row) => row.status === "scheduled").length,
    overdue_total: mapped.filter((row) => row.is_overdue).length,
    urgent_total: mapped.filter((row) => row.is_open && row.priority === "urgent").length,
    high_total: mapped.filter((row) => row.is_open && row.priority === "high").length,
    max_priority: maxPriority,
    active,
    recent,
  };
};
