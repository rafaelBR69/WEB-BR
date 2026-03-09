import type { AstroCookies } from "astro";
import { resolveCrmAuthFromCookies } from "@/utils/crmAuth";
import { getSupabaseServerClient } from "@/utils/supabaseServer";

export type CrmMembershipRole = "owner" | "admin" | "agent" | "finance" | "legal" | "viewer";
export const CRM_PERMISSION_KEYS = [
  "crm.dashboard.view",
  "crm.profile.view",
  "crm.leads.read",
  "crm.leads.write",
  "crm.properties.read",
  "crm.properties.write",
  "crm.clients.read",
  "crm.clients.write",
  "crm.portal.read",
  "crm.portal.write",
  "crm.documents.manage",
  "crm.notifications.read",
  "crm.notifications.write",
  "crm.contracts.read",
  "crm.contracts.write",
  "crm.invoices.read",
  "crm.invoices.write",
  "crm.users.manage",
] as const;
export type CrmPermission = (typeof CRM_PERMISSION_KEYS)[number];

export type CrmAccessError = {
  status: number;
  error: string;
  details?: string;
};

export type CrmAccessData = {
  auth_user_id: string;
  auth_email: string | null;
  organization_id: string;
  role: CrmMembershipRole;
  permissions: CrmPermission[];
  permissions_granted: CrmPermission[];
  permissions_revoked: CrmPermission[];
  memberships: Array<{
    organization_id: string;
    role: CrmMembershipRole;
  }>;
};

export type CrmAccessResult = {
  data: CrmAccessData | null;
  error: CrmAccessError | null;
};

export const CRM_ADMIN_ROLES: ReadonlyArray<CrmMembershipRole> = ["owner", "admin"];
export const CRM_EDITOR_ROLES: ReadonlyArray<CrmMembershipRole> = ["owner", "admin", "agent"];
export const CRM_ROLE_BASE_PERMISSIONS: Readonly<Record<CrmMembershipRole, ReadonlyArray<CrmPermission>>> = {
  owner: CRM_PERMISSION_KEYS,
  admin: CRM_PERMISSION_KEYS,
  agent: [
    "crm.dashboard.view",
    "crm.profile.view",
    "crm.leads.read",
    "crm.leads.write",
    "crm.properties.read",
    "crm.properties.write",
    "crm.clients.read",
    "crm.clients.write",
    "crm.portal.read",
    "crm.portal.write",
    "crm.documents.manage",
    "crm.notifications.read",
  ],
  finance: [
    "crm.dashboard.view",
    "crm.profile.view",
    "crm.leads.read",
    "crm.properties.read",
    "crm.clients.read",
    "crm.invoices.read",
    "crm.invoices.write",
    "crm.contracts.read",
    "crm.notifications.read",
  ],
  legal: [
    "crm.dashboard.view",
    "crm.profile.view",
    "crm.leads.read",
    "crm.properties.read",
    "crm.clients.read",
    "crm.contracts.read",
    "crm.contracts.write",
    "crm.documents.manage",
    "crm.notifications.read",
  ],
  viewer: [
    "crm.dashboard.view",
    "crm.profile.view",
    "crm.leads.read",
    "crm.properties.read",
    "crm.clients.read",
    "crm.portal.read",
    "crm.notifications.read",
    "crm.contracts.read",
    "crm.invoices.read",
  ],
} as const;

const ALL_MEMBERSHIP_ROLES = new Set<CrmMembershipRole>(["owner", "admin", "agent", "finance", "legal", "viewer"]);
const ALL_PERMISSIONS = new Set<CrmPermission>(CRM_PERMISSION_KEYS);

const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const isCrmMembershipRole = (value: unknown): value is CrmMembershipRole => {
  return typeof value === "string" && ALL_MEMBERSHIP_ROLES.has(value as CrmMembershipRole);
};

export const isCrmPermission = (value: unknown): value is CrmPermission => {
  return typeof value === "string" && ALL_PERMISSIONS.has(value as CrmPermission);
};

export const normalizeCrmPermissionList = (value: unknown): CrmPermission[] => {
  if (Array.isArray(value)) {
    const unique = new Set<CrmPermission>();
    value.forEach((entry) => {
      if (isCrmPermission(entry)) unique.add(entry);
      else if (typeof entry === "string" && isCrmPermission(entry.trim())) unique.add(entry.trim() as CrmPermission);
    });
    return Array.from(unique);
  }

  const text = asText(value);
  if (!text) return [];
  return normalizeCrmPermissionList(
    text
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
};

export const resolveEffectiveCrmPermissions = (
  role: CrmMembershipRole,
  granted: ReadonlyArray<CrmPermission> = [],
  revoked: ReadonlyArray<CrmPermission> = []
): CrmPermission[] => {
  const base = CRM_ROLE_BASE_PERMISSIONS[role] ?? [];
  const permissionSet = new Set<CrmPermission>(base);
  granted.forEach((entry) => permissionSet.add(entry));
  revoked.forEach((entry) => permissionSet.delete(entry));
  return Array.from(permissionSet);
};

const withError = (status: number, error: string, details?: string): CrmAccessResult => ({
  data: null,
  error: { status, error, details },
});

export const hasCrmRole = (role: CrmMembershipRole, allowedRoles: ReadonlyArray<CrmMembershipRole>): boolean => {
  return allowedRoles.includes(role);
};

export const resolveCrmOrgAccess = async (
  cookies: AstroCookies,
  options: {
    organizationIdHint?: string | null;
    allowedRoles?: ReadonlyArray<CrmMembershipRole>;
    allowedPermissions?: ReadonlyArray<CrmPermission>;
    requireAllPermissions?: boolean;
  } = {}
): Promise<CrmAccessResult> => {
  const auth = await resolveCrmAuthFromCookies(cookies);
  if (!auth.ok || !auth.user) {
    return withError(401, auth.error ?? "crm_auth_required");
  }

  const authUserId = asText(auth.user.id);
  if (!authUserId) return withError(401, "crm_auth_required");

  const client = getSupabaseServerClient();
  if (!client) return withError(500, "supabase_not_configured");

  const organizationIdHint = asText(options.organizationIdHint);
  let membershipsQuery = client
    .schema("crm")
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", authUserId)
    .eq("is_active", true);

  if (organizationIdHint) membershipsQuery = membershipsQuery.eq("organization_id", organizationIdHint);

  const { data: membershipsRaw, error: membershipsError } = await membershipsQuery;
  if (membershipsError) {
    return withError(500, "db_memberships_read_error", membershipsError.message);
  }

  const memberships = (membershipsRaw ?? [])
    .map((row) => {
      const entry = row as Record<string, unknown>;
      const organizationId = asText(entry.organization_id);
      const role = entry.role;
      if (!organizationId || !isCrmMembershipRole(role)) return null;
      return {
        organization_id: organizationId,
        role,
      };
    })
    .filter((value): value is { organization_id: string; role: CrmMembershipRole } => Boolean(value));

  if (!memberships.length) {
    return withError(403, "crm_membership_required");
  }

  const activeMembership =
    (organizationIdHint ? memberships.find((item) => item.organization_id === organizationIdHint) : null) ?? memberships[0];

  if (!activeMembership) {
    return withError(403, "crm_membership_required");
  }

  if (options.allowedRoles?.length && !hasCrmRole(activeMembership.role, options.allowedRoles)) {
    return withError(403, "crm_role_forbidden");
  }

  const userMetadata = asObject(auth.user.user_metadata);
  const permissionsGranted = normalizeCrmPermissionList(
    userMetadata.crm_permissions_granted ?? userMetadata.crm_permissions
  );
  const permissionsRevoked = normalizeCrmPermissionList(userMetadata.crm_permissions_revoked);
  const permissions = resolveEffectiveCrmPermissions(activeMembership.role, permissionsGranted, permissionsRevoked);

  if (options.allowedPermissions?.length) {
    const requireAllPermissions = options.requireAllPermissions !== false;
    const permissionsSet = new Set<CrmPermission>(permissions);
    const hasRequired = requireAllPermissions
      ? options.allowedPermissions.every((entry) => permissionsSet.has(entry))
      : options.allowedPermissions.some((entry) => permissionsSet.has(entry));
    if (!hasRequired) {
      return withError(403, "crm_permission_forbidden");
    }
  }

  return {
    data: {
      auth_user_id: authUserId,
      auth_email: asText(auth.user.email)?.toLowerCase() ?? null,
      organization_id: activeMembership.organization_id,
      role: activeMembership.role,
      permissions,
      permissions_granted: permissionsGranted,
      permissions_revoked: permissionsRevoked,
      memberships,
    },
    error: null,
  };
};
