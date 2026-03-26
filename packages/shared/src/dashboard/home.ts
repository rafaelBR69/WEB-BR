import type { CrmMembershipRole, CrmPermission } from "@shared/crm/access";
import type { DealStage } from "@shared/deals/domain";

export const DASHBOARD_SCOPES = ["mine", "team"] as const;
export const DASHBOARD_WINDOWS = ["today", "7d", "30d"] as const;
export const DASHBOARD_PRIORITIES = ["urgent", "high", "normal"] as const;
export const DASHBOARD_ALERT_TONES = ["info", "warn", "danger"] as const;
export const DASHBOARD_INBOX_KINDS = [
  "lead_new_unworked",
  "lead_stalled",
  "deal_overdue",
  "deal_missing_close_date",
  "reservation_docs_missing",
  "visit_request_pending",
  "commission_pending",
  "notification_due",
] as const;
export const DASHBOARD_RESERVATION_STATUSES = [
  "pre_registered",
  "reservation_sent",
  "reserved",
  "adhesion_paid",
  "contract_signed",
  "cancelled",
  "discarded",
  "other",
] as const;

export type DashboardScope = (typeof DASHBOARD_SCOPES)[number];
export type DashboardWindow = (typeof DASHBOARD_WINDOWS)[number];
export type DashboardPriority = (typeof DASHBOARD_PRIORITIES)[number];
export type DashboardAlertTone = (typeof DASHBOARD_ALERT_TONES)[number];
export type DashboardInboxKind = (typeof DASHBOARD_INBOX_KINDS)[number];
export type DashboardReservationStatus = (typeof DASHBOARD_RESERVATION_STATUSES)[number];

export type DashboardViewer = {
  auth_user_id: string | null;
  auth_email: string | null;
  organization_id: string | null;
  role: CrmMembershipRole | null;
  permissions: CrmPermission[];
};

export type DashboardQuickLink = {
  id: string;
  label: string;
  href: string;
  permission_required: CrmPermission | null;
};

export type DashboardSummaryCard = {
  id: string;
  label: string;
  value: number | null;
  sublabel: string;
  href: string | null;
  tone: "neutral" | "ok" | "warn" | "danger";
  enabled: boolean;
};

export type DashboardAlert = {
  id: string;
  tone: DashboardAlertTone;
  title: string;
  message: string;
  href: string | null;
};

export type DashboardInboxItem = {
  id: string;
  kind: DashboardInboxKind;
  bucket: DashboardScope;
  priority: DashboardPriority;
  title: string;
  reason: string;
  age_label: string;
  href: string;
  cta_label: string;
  entity_id: string | null;
  entity_type: "lead" | "deal" | "reservation" | "visit_request" | "commission" | "notification";
  date: string | null;
  meta: string[];
};

export type DashboardPipelineRow = {
  stage: DealStage;
  label: string;
  total: number;
  expected_value_total: number;
  is_terminal: boolean;
};

export type DashboardStatusBreakdownRow = {
  status: string;
  label: string;
  total: number;
  is_active: boolean;
};

export type DashboardHomeResponse = {
  viewer: DashboardViewer;
  filters: {
    scope: DashboardScope;
    window: DashboardWindow;
    as_of: string;
  };
  summary: DashboardSummaryCard[];
  alerts: DashboardAlert[];
  inbox: {
    mine: DashboardInboxItem[];
    team: DashboardInboxItem[];
    total_mine: number;
    total_team: number;
  };
  pipeline: {
    enabled: boolean;
    by_stage: DashboardPipelineRow[];
    open_total: number;
    overdue_total: number;
    missing_expected_close_total: number;
    expected_value_open_total: number;
  };
  reservations: {
    enabled: boolean;
    active_total: number;
    docs_pending_total: number;
    status_breakdown: DashboardStatusBreakdownRow[];
  };
  portal: {
    enabled: boolean;
    visit_requests: {
      total: number;
      requested: number;
      confirmed: number;
      declined: number;
      done: number;
      no_show: number;
      cancelled: number;
    };
    commissions: {
      total: number;
      pending: number;
      approved: number;
      paid: number;
      cancelled: number;
    };
  };
  notifications: {
    enabled: boolean;
    pending_count: number;
    scheduled_count: number;
    overdue_count: number;
  };
  quick_links: DashboardQuickLink[];
};

export const normalizeDashboardScope = (value: unknown, fallback: DashboardScope = "mine"): DashboardScope => {
  return value === "team" ? "team" : fallback;
};

export const normalizeDashboardWindow = (value: unknown, fallback: DashboardWindow = "7d"): DashboardWindow => {
  if (value === "today" || value === "7d" || value === "30d") return value;
  return fallback;
};
