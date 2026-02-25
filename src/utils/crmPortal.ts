import type { SupabaseClient } from "@supabase/supabase-js";

export type PortalRole = "portal_agent_admin" | "portal_agent_member" | "portal_client";
export type PortalInviteType = "agent" | "client";
export type PortalAccountStatus = "pending" | "active" | "blocked" | "revoked";
export type PortalMembershipScope = "read" | "read_write" | "full";
export type PortalAudience = "agent" | "client" | "both";
export type PortalDocumentVisibility = "crm_only" | "agent" | "client" | "both";
export type PortalInviteStatus = "pending" | "used" | "expired" | "revoked" | "blocked";
export type PortalLeadAttributionStatus =
  | "pending_review"
  | "attributed"
  | "rejected_duplicate"
  | "existing_client"
  | "manual_review";

export type PortalAccessEventType =
  | "invite_sent"
  | "invite_revoked"
  | "signup_ok"
  | "signup_fail"
  | "login_ok"
  | "login_fail"
  | "code_fail"
  | "blocked"
  | "logout"
  | "lead_submitted"
  | "duplicate_detected"
  | "visit_requested"
  | "visit_confirmed"
  | "commission_updated";

export const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PORTAL_ACCOUNT_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "auth_user_id",
  "contact_id",
  "client_id",
  "agency_id",
  "role",
  "status",
  "last_login_at",
  "blocked_at",
  "revoked_at",
  "metadata",
  "created_by",
  "created_at",
  "updated_at",
].join(", ");

export const PORTAL_MEMBERSHIP_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "portal_account_id",
  "project_property_id",
  "access_scope",
  "status",
  "dispute_window_hours",
  "permissions",
  "revoked_at",
  "created_by",
  "created_at",
  "updated_at",
].join(", ");

export const PORTAL_INVITE_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "email",
  "email_normalized",
  "invite_type",
  "role",
  "project_property_id",
  "code_hash",
  "code_last4",
  "status",
  "expires_at",
  "max_attempts",
  "attempt_count",
  "used_at",
  "revoked_at",
  "blocked_at",
  "metadata",
  "created_by",
  "created_at",
  "updated_at",
].join(", ");

export const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

export const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

export const asBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  return null;
};

export const isPortalProjectPublished = (projectRow: Record<string, unknown> | null | undefined): boolean => {
  if (!projectRow) return false;
  const project = asObject(projectRow);
  const propertyData = asObject(project.property_data);
  const portalEnabled = asBoolean(propertyData.portal_enabled);
  return portalEnabled !== false;
};

export const asUuid = (value: unknown): string | null => {
  const text = asText(value);
  if (!text) return null;
  return UUID_RX.test(text) ? text : null;
};

export const toPositiveInt = (value: string | null, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
};

export const normalizePortalRole = (value: unknown): PortalRole => {
  if (value === "portal_agent_admin" || value === "portal_agent_member" || value === "portal_client") {
    return value;
  }
  return "portal_client";
};

export const normalizePortalInviteType = (value: unknown): PortalInviteType => {
  if (value === "agent" || value === "client") return value;
  return "client";
};

export const normalizePortalInviteStatus = (value: unknown): PortalInviteStatus => {
  if (value === "pending" || value === "used" || value === "expired" || value === "revoked" || value === "blocked") {
    return value;
  }
  return "pending";
};

export const normalizePortalMembershipScope = (value: unknown): PortalMembershipScope => {
  if (value === "read" || value === "read_write" || value === "full") return value;
  return "read";
};

export const normalizePortalAudience = (value: unknown): PortalAudience => {
  if (value === "agent" || value === "client" || value === "both") return value;
  return "both";
};

export const normalizePortalDocumentVisibility = (value: unknown): PortalDocumentVisibility => {
  if (value === "crm_only" || value === "agent" || value === "client" || value === "both") return value;
  return "crm_only";
};

export const normalizePortalLeadAttributionStatus = (value: unknown): PortalLeadAttributionStatus => {
  if (
    value === "pending_review" ||
    value === "attributed" ||
    value === "rejected_duplicate" ||
    value === "existing_client" ||
    value === "manual_review"
  ) {
    return value;
  }
  return "pending_review";
};

export const isAgentPortalRole = (role: PortalRole): boolean =>
  role === "portal_agent_admin" || role === "portal_agent_member";

export const isClientPortalRole = (role: PortalRole): boolean => role === "portal_client";

export const inviteTypeMatchesRole = (inviteType: PortalInviteType, role: PortalRole): boolean => {
  if (inviteType === "client") return role === "portal_client";
  return role === "portal_agent_admin" || role === "portal_agent_member";
};

export const audienceAllowedForRole = (role: PortalRole, audience: PortalAudience): boolean => {
  if (audience === "both") return true;
  if (audience === "agent") return isAgentPortalRole(role);
  return isClientPortalRole(role);
};

export const documentVisibilityAllowedForRole = (
  role: PortalRole,
  visibility: PortalDocumentVisibility
): boolean => {
  if (visibility === "both") return true;
  if (visibility === "agent") return isAgentPortalRole(role);
  if (visibility === "client") return isClientPortalRole(role);
  return false;
};

export const defaultMembershipScopeForRole = (role: PortalRole): PortalMembershipScope => {
  if (role === "portal_agent_admin") return "full";
  if (role === "portal_agent_member") return "read_write";
  return "read";
};

const toHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const createRandomSalt = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const generateInviteCode = (length = 8): string => {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += charset[bytes[i] % charset.length];
  }
  return code;
};

export const hashInviteCode = async (plainCode: string, salt?: string): Promise<string> => {
  const normalized = plainCode.trim().toUpperCase();
  const resolvedSalt = salt ?? createRandomSalt();
  const payload = new TextEncoder().encode(`${resolvedSalt}:${normalized}`);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return `sha256:${resolvedSalt}:${toHex(digest)}`;
};

export const verifyInviteCode = async (storedHash: string, plainCode: string): Promise<boolean> => {
  const parts = storedHash.split(":");
  if (parts.length !== 3) return false;
  const [algorithm, salt, expectedDigest] = parts;
  if (algorithm !== "sha256" || !salt || !expectedDigest) return false;
  const rebuilt = await hashInviteCode(plainCode, salt);
  return rebuilt === storedHash;
};

export const mapPortalAccountRow = (row: Record<string, unknown>) => {
  const role = normalizePortalRole(row.role);
  const status = (() => {
    if (row.status === "pending" || row.status === "active" || row.status === "blocked" || row.status === "revoked") {
      return row.status;
    }
    return "pending";
  })() as PortalAccountStatus;

  return {
    id: asText(row.id),
    organization_id: asText(row.organization_id),
    auth_user_id: asText(row.auth_user_id),
    contact_id: asText(row.contact_id),
    client_id: asText(row.client_id),
    agency_id: asText(row.agency_id),
    role,
    status,
    last_login_at: asText(row.last_login_at),
    blocked_at: asText(row.blocked_at),
    revoked_at: asText(row.revoked_at),
    metadata: asObject(row.metadata),
    created_by: asText(row.created_by),
    created_at: asText(row.created_at),
    updated_at: asText(row.updated_at),
  };
};

export const mapPortalInviteRow = (row: Record<string, unknown>) => ({
  id: asText(row.id),
  organization_id: asText(row.organization_id),
  email: asText(row.email),
  email_normalized: asText(row.email_normalized),
  invite_type: normalizePortalInviteType(row.invite_type),
  role: normalizePortalRole(row.role),
  project_property_id: asText(row.project_property_id),
  code_last4: asText(row.code_last4),
  status: normalizePortalInviteStatus(row.status),
  expires_at: asText(row.expires_at),
  max_attempts: asNumber(row.max_attempts) ?? 5,
  attempt_count: asNumber(row.attempt_count) ?? 0,
  used_at: asText(row.used_at),
  revoked_at: asText(row.revoked_at),
  blocked_at: asText(row.blocked_at),
  metadata: asObject(row.metadata),
  created_by: asText(row.created_by),
  created_at: asText(row.created_at),
  updated_at: asText(row.updated_at),
});

export const mapPortalMembershipRow = (row: Record<string, unknown>) => ({
  id: asText(row.id),
  organization_id: asText(row.organization_id),
  portal_account_id: asText(row.portal_account_id),
  project_property_id: asText(row.project_property_id),
  access_scope: normalizePortalMembershipScope(row.access_scope),
  status:
    row.status === "active" || row.status === "paused" || row.status === "revoked" ? row.status : "active",
  dispute_window_hours: asNumber(row.dispute_window_hours) ?? 48,
  permissions: asObject(row.permissions),
  revoked_at: asText(row.revoked_at),
  created_by: asText(row.created_by),
  created_at: asText(row.created_at),
  updated_at: asText(row.updated_at),
});

export const getPortalAccountById = async (
  client: SupabaseClient,
  portalAccountId: string,
  organizationId: string | null = null
) => {
  let query = client
    .schema("crm")
    .from("portal_accounts")
    .select(PORTAL_ACCOUNT_SELECT_COLUMNS)
    .eq("id", portalAccountId)
    .maybeSingle();

  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data, error } = await query;
  if (error) return { data: null, error };
  return { data: data ? mapPortalAccountRow(data as Record<string, unknown>) : null, error: null };
};

export const getActivePortalMembershipForProject = async (
  client: SupabaseClient,
  portalAccountId: string,
  projectPropertyId: string,
  organizationId: string | null = null
) => {
  let query = client
    .schema("crm")
    .from("portal_memberships")
    .select(PORTAL_MEMBERSHIP_SELECT_COLUMNS)
    .eq("portal_account_id", portalAccountId)
    .eq("project_property_id", projectPropertyId)
    .eq("status", "active")
    .maybeSingle();

  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data, error } = await query;
  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };

  let projectQuery = client
    .schema("crm")
    .from("properties")
    .select("id, organization_id, record_type, property_data")
    .eq("id", projectPropertyId)
    .eq("record_type", "project")
    .maybeSingle();

  if (organizationId) {
    projectQuery = projectQuery.eq("organization_id", organizationId);
  }

  const { data: projectRow, error: projectError } = await projectQuery;
  if (projectError) return { data: null, error: projectError };
  if (!projectRow) return { data: null, error: null };
  if (!isPortalProjectPublished(projectRow as Record<string, unknown>)) {
    return { data: null, error: null };
  }

  return { data: mapPortalMembershipRow(data as Record<string, unknown>), error: null };
};

export const getPortalInviteById = async (client: SupabaseClient, inviteId: string) => {
  const { data, error } = await client
    .schema("crm")
    .from("portal_invites")
    .select(PORTAL_INVITE_SELECT_COLUMNS)
    .eq("id", inviteId)
    .maybeSingle();

  if (error) return { data: null, error };
  return { data: data ? mapPortalInviteRow(data as Record<string, unknown>) : null, error: null };
};

export const findLatestPendingInviteByEmail = async (
  client: SupabaseClient,
  organizationId: string,
  email: string,
  projectPropertyId: string | null = null
) => {
  let query = client
    .schema("crm")
    .from("portal_invites")
    .select(PORTAL_INVITE_SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("email_normalized", email.trim().toLowerCase())
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(25);

  if (projectPropertyId) {
    query = query.eq("project_property_id", projectPropertyId);
  }

  const { data, error } = await query;
  if (error) return { data: null, error };

  const rows = (data ?? []).map((row) => mapPortalInviteRow(row as Record<string, unknown>));
  if (!rows.length) return { data: null, error: null };
  return { data: rows[0], error: null };
};

export const findLatestPendingInviteRowByEmail = async (
  client: SupabaseClient,
  organizationId: string,
  email: string,
  projectPropertyId: string | null = null
) => {
  let query = client
    .schema("crm")
    .from("portal_invites")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("email_normalized", email.trim().toLowerCase())
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);

  if (projectPropertyId) {
    query = query.eq("project_property_id", projectPropertyId);
  }

  const { data, error } = await query;
  if (error) return { data: null, error };
  const row = Array.isArray(data) && data.length ? (data[0] as Record<string, unknown>) : null;
  return { data: row, error: null };
};

export const insertPortalAccessLog = async (
  client: SupabaseClient,
  payload: {
    organization_id: string;
    portal_account_id?: string | null;
    lead_id?: string | null;
    project_property_id?: string | null;
    email?: string | null;
    event_type: PortalAccessEventType;
    ip?: string | null;
    user_agent?: string | null;
    metadata?: Record<string, unknown>;
  }
) => {
  await client.schema("crm").from("portal_access_logs").insert({
    organization_id: payload.organization_id,
    portal_account_id: payload.portal_account_id ?? null,
    lead_id: payload.lead_id ?? null,
    project_property_id: payload.project_property_id ?? null,
    email: payload.email ?? null,
    event_type: payload.event_type,
    ip: payload.ip ?? null,
    user_agent: payload.user_agent ?? null,
    metadata: payload.metadata ?? {},
  });
};

export const safeInsertPortalAccessLog = async (
  client: SupabaseClient,
  payload: {
    organization_id: string;
    portal_account_id?: string | null;
    lead_id?: string | null;
    project_property_id?: string | null;
    email?: string | null;
    event_type: PortalAccessEventType;
    ip?: string | null;
    user_agent?: string | null;
    metadata?: Record<string, unknown>;
  }
) => {
  try {
    await insertPortalAccessLog(client, payload);
  } catch {
    // no-op: logs should never break main flow
  }
};

export const getRequestIp = (request: Request): string | null => {
  const value =
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip");

  if (!value) return null;
  const ip = value.split(",")[0]?.trim();
  return ip && ip.length ? ip : null;
};

export const getRequestUserAgent = (request: Request): string | null => {
  const value = request.headers.get("user-agent");
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};
