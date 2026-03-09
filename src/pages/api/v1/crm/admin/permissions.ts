import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { getSupabaseServerClient } from "@/utils/supabaseServer";
import {
  CRM_ADMIN_ROLES,
  CRM_PERMISSION_KEYS,
  CRM_ROLE_BASE_PERMISSIONS,
  type CrmMembershipRole,
  normalizeCrmPermissionList,
  resolveCrmOrgAccess,
  resolveEffectiveCrmPermissions,
} from "@/utils/crmAccess";
import { asText, asUuid, toPositiveInt } from "@/utils/crmPortal";

type MembershipRow = {
  id: string;
  organization_id: string;
  user_id: string;
  role: CrmMembershipRole;
  is_active: boolean;
  created_at: string | null;
};

type PatchPermissionsBody = {
  organization_id?: string;
  membership_id?: string;
  user_id?: string;
  role?: CrmMembershipRole;
  is_active?: boolean;
  full_name?: string | null;
  permissions_granted?: unknown;
  permissions_revoked?: unknown;
};

type CreatePermissionsBody = {
  organization_id?: string;
  email?: string;
  password?: string;
  full_name?: string | null;
  role?: CrmMembershipRole;
  is_active?: boolean;
  permissions_granted?: unknown;
  permissions_revoked?: unknown;
};

const ALL_MEMBERSHIP_ROLES: ReadonlyArray<CrmMembershipRole> = ["owner", "admin", "agent", "finance", "legal", "viewer"];

const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const isCrmMembershipRole = (value: unknown): value is CrmMembershipRole =>
  value === "owner" ||
  value === "admin" ||
  value === "agent" ||
  value === "finance" ||
  value === "legal" ||
  value === "viewer";

const normalizeRole = (value: unknown): CrmMembershipRole | null => {
  return isCrmMembershipRole(value) ? value : null;
};

const normalizeBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  return null;
};

const isAlreadyRegisteredError = (details: string | null): boolean => {
  const normalized = String(details ?? "").toLowerCase();
  return normalized.includes("already registered") || normalized.includes("already been registered");
};

const loadAuthUsersById = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  userIds: string[]
) => {
  const pending = new Set(userIds);
  const usersById = new Map<string, Record<string, unknown>>();
  if (!pending.size) return usersById;

  const perPage = 200;
  for (let page = 1; page <= 50 && pending.size > 0; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`auth_list_users_error:${error.message}`);
    }
    const users = Array.isArray(data?.users) ? data.users : [];
    users.forEach((entry) => {
      const id = asUuid((entry as Record<string, unknown>).id);
      if (!id || !pending.has(id)) return;
      usersById.set(id, entry as unknown as Record<string, unknown>);
      pending.delete(id);
    });
    if (users.length < perPage) break;
  }

  return usersById;
};

const findAuthUserByEmail = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  email: string
): Promise<Record<string, unknown> | null> => {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const perPage = 200;
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`auth_list_users_error:${error.message}`);
    const users = Array.isArray(data?.users) ? data.users : [];
    const hit =
      users.find((entry) => asText((entry as Record<string, unknown>).email)?.toLowerCase() === normalizedEmail) ?? null;
    if (hit) return hit as unknown as Record<string, unknown>;
    if (users.length < perPage) break;
  }

  return null;
};

const upsertMembership = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  params: {
    organizationId: string;
    userId: string;
    role: CrmMembershipRole;
    isActive: boolean;
  }
): Promise<MembershipRow> => {
  const { data, error } = await client
    .schema("crm")
    .from("memberships")
    .upsert(
      {
        organization_id: params.organizationId,
        user_id: params.userId,
        role: params.role,
        is_active: params.isActive,
      },
      { onConflict: "organization_id,user_id" }
    )
    .select("id, organization_id, user_id, role, is_active, created_at")
    .single();

  if (error) throw new Error(`db_membership_upsert_error:${error.message}`);

  const row = data as Record<string, unknown>;
  const mapped: MembershipRow = {
    id: asUuid(row.id) ?? "",
    organization_id: asUuid(row.organization_id) ?? params.organizationId,
    user_id: asUuid(row.user_id) ?? params.userId,
    role: normalizeRole(row.role) ?? params.role,
    is_active: typeof row.is_active === "boolean" ? row.is_active : params.isActive,
    created_at: asText(row.created_at),
  };
  if (!mapped.id || !mapped.organization_id || !mapped.user_id) {
    throw new Error("membership_upsert_invalid_shape");
  }
  return mapped;
};

const mapMembershipWithUser = (row: MembershipRow, user: Record<string, unknown> | null) => {
  const userMetadata = asObject(user?.user_metadata);
  const granted = normalizeCrmPermissionList(userMetadata.crm_permissions_granted ?? userMetadata.crm_permissions);
  const revoked = normalizeCrmPermissionList(userMetadata.crm_permissions_revoked);
  const effective = resolveEffectiveCrmPermissions(row.role, granted, revoked);

  return {
    membership_id: row.id,
    organization_id: row.organization_id,
    user_id: row.user_id,
    role: row.role,
    is_active: row.is_active,
    created_at: row.created_at,
    user: {
      email: asText(user?.email),
      full_name: asText(userMetadata.full_name) ?? asText(userMetadata.name),
      last_sign_in_at: asText(user?.last_sign_in_at),
      created_at: asText(user?.created_at),
    },
    permissions_granted: granted,
    permissions_revoked: revoked,
    permissions_effective: effective,
  };
};

const permissionDefaultRoles = CRM_PERMISSION_KEYS.map((key) => ({
  key,
  default_roles: ALL_MEMBERSHIP_ROLES.filter((role) => (CRM_ROLE_BASE_PERMISSIONS[role] ?? []).includes(key)),
}));

export const GET: APIRoute = async ({ cookies, url }) => {
  const organizationIdHint = asText(url.searchParams.get("organization_id"));
  const q = asText(url.searchParams.get("q"))?.toLowerCase() ?? "";
  const page = toPositiveInt(url.searchParams.get("page"), 1, 1, 10000);
  const perPage = toPositiveInt(url.searchParams.get("per_page"), 25, 1, 200);

  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint,
    allowedRoles: CRM_ADMIN_ROLES,
    allowedPermissions: ["crm.users.manage"],
  });
  if (access.error || !access.data) {
    return jsonResponse(
      {
        ok: false,
        error: access.error?.error ?? "crm_auth_required",
        details: access.error?.details,
      },
      { status: access.error?.status ?? 401 }
    );
  }

  const organizationId = access.data.organization_id;
  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const { data: membershipsRaw, error: membershipsError } = await client
    .schema("crm")
    .from("memberships")
    .select("id, organization_id, user_id, role, is_active, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (membershipsError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_memberships_read_error",
        details: membershipsError.message,
      },
      { status: 500 }
    );
  }

  const memberships = (membershipsRaw ?? [])
    .map((entry) => {
      const row = entry as Record<string, unknown>;
      const id = asUuid(row.id);
      const userId = asUuid(row.user_id);
      const role = normalizeRole(row.role);
      const orgId = asUuid(row.organization_id);
      const isActive = typeof row.is_active === "boolean" ? row.is_active : true;
      if (!id || !userId || !orgId || !role) return null;
      return {
        id,
        organization_id: orgId,
        user_id: userId,
        role,
        is_active: isActive,
        created_at: asText(row.created_at),
      } as MembershipRow;
    })
    .filter((row): row is MembershipRow => Boolean(row));

  const usersById = await loadAuthUsersById(
    client,
    memberships.map((entry) => entry.user_id)
  );

  const rows = memberships.map((row) => mapMembershipWithUser(row, usersById.get(row.user_id) ?? null));
  const filteredRows = rows.filter((row) => {
    if (!q) return true;
    const composed = `${row.user.full_name ?? ""} ${row.user.email ?? ""} ${row.role} ${row.user_id}`.toLowerCase();
    return composed.includes(q);
  });

  const total = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const from = (page - 1) * perPage;
  const to = from + perPage;
  const data = filteredRows.slice(from, to);

  return jsonResponse({
    ok: true,
    data,
    meta: {
      organization_id: organizationId,
      actor_role: access.data.role,
      available_roles: ALL_MEMBERSHIP_ROLES,
      available_permissions: permissionDefaultRoles,
      total,
      page,
      per_page: perPage,
      total_pages: totalPages,
      count: data.length,
      storage: "supabase.auth.users + crm.memberships + user_metadata.permissions",
    },
  });
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const body = await parseJsonBody<PatchPermissionsBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationIdHint = asText(body.organization_id);
  const membershipId = asUuid(body.membership_id);
  const userId = asUuid(body.user_id);
  const nextRole = body.role != null ? normalizeRole(body.role) : null;
  const nextIsActive = body.is_active != null ? normalizeBoolean(body.is_active) : null;
  const nextFullName = body.full_name != null ? asText(body.full_name) : undefined;
  const grantedProvided = body.permissions_granted !== undefined;
  const revokedProvided = body.permissions_revoked !== undefined;
  const nextGranted = grantedProvided ? normalizeCrmPermissionList(body.permissions_granted) : null;
  const nextRevoked = revokedProvided ? normalizeCrmPermissionList(body.permissions_revoked) : null;

  if (!membershipId && !userId) {
    return jsonResponse({ ok: false, error: "membership_id_or_user_id_required" }, { status: 422 });
  }
  if (body.role != null && !nextRole) {
    return jsonResponse({ ok: false, error: "invalid_role" }, { status: 422 });
  }
  if (body.is_active != null && nextIsActive == null) {
    return jsonResponse({ ok: false, error: "invalid_is_active" }, { status: 422 });
  }

  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint,
    allowedRoles: CRM_ADMIN_ROLES,
    allowedPermissions: ["crm.users.manage"],
  });
  if (access.error || !access.data) {
    return jsonResponse(
      {
        ok: false,
        error: access.error?.error ?? "crm_auth_required",
        details: access.error?.details,
      },
      { status: access.error?.status ?? 401 }
    );
  }

  const organizationId = access.data.organization_id;
  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  let membershipQuery = client
    .schema("crm")
    .from("memberships")
    .select("id, organization_id, user_id, role, is_active, created_at")
    .eq("organization_id", organizationId);

  if (membershipId) membershipQuery = membershipQuery.eq("id", membershipId);
  else if (userId) membershipQuery = membershipQuery.eq("user_id", userId);

  const { data: membershipRaw, error: membershipError } = await membershipQuery.maybeSingle();
  if (membershipError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_membership_read_error",
        details: membershipError.message,
      },
      { status: 500 }
    );
  }
  if (!membershipRaw) return jsonResponse({ ok: false, error: "membership_not_found" }, { status: 404 });

  const membershipRow = membershipRaw as Record<string, unknown>;
  const targetMembership: MembershipRow = {
    id: asUuid(membershipRow.id) ?? "",
    organization_id: asUuid(membershipRow.organization_id) ?? "",
    user_id: asUuid(membershipRow.user_id) ?? "",
    role: normalizeRole(membershipRow.role) ?? "viewer",
    is_active: typeof membershipRow.is_active === "boolean" ? membershipRow.is_active : true,
    created_at: asText(membershipRow.created_at),
  };
  if (!targetMembership.id || !targetMembership.user_id || !targetMembership.organization_id) {
    return jsonResponse({ ok: false, error: "membership_invalid_shape" }, { status: 500 });
  }

  if (access.data.role !== "owner" && targetMembership.role === "owner") {
    return jsonResponse({ ok: false, error: "owner_membership_requires_owner_actor" }, { status: 403 });
  }
  if (nextRole === "owner" && access.data.role !== "owner") {
    return jsonResponse({ ok: false, error: "owner_role_requires_owner_actor" }, { status: 403 });
  }

  const membershipUpdatePayload: Record<string, unknown> = {};
  if (nextRole) membershipUpdatePayload.role = nextRole;
  if (nextIsActive != null) membershipUpdatePayload.is_active = nextIsActive;

  let updatedMembership = targetMembership;
  if (Object.keys(membershipUpdatePayload).length) {
    const { data: membershipUpdatedRaw, error: membershipUpdateError } = await client
      .schema("crm")
      .from("memberships")
      .update(membershipUpdatePayload)
      .eq("organization_id", organizationId)
      .eq("id", targetMembership.id)
      .select("id, organization_id, user_id, role, is_active, created_at")
      .single();

    if (membershipUpdateError) {
      return jsonResponse(
        {
          ok: false,
          error: "db_membership_update_error",
          details: membershipUpdateError.message,
        },
        { status: 500 }
      );
    }

    const row = membershipUpdatedRaw as Record<string, unknown>;
    updatedMembership = {
      id: asUuid(row.id) ?? targetMembership.id,
      organization_id: asUuid(row.organization_id) ?? targetMembership.organization_id,
      user_id: asUuid(row.user_id) ?? targetMembership.user_id,
      role: normalizeRole(row.role) ?? targetMembership.role,
      is_active: typeof row.is_active === "boolean" ? row.is_active : targetMembership.is_active,
      created_at: asText(row.created_at) ?? targetMembership.created_at,
    };
  }

  const mustUpdateUserMetadata =
    grantedProvided || revokedProvided || body.full_name !== undefined || nextRole !== null;

  let updatedUser: Record<string, unknown> | null = null;
  if (mustUpdateUserMetadata) {
    const { data: authUserData, error: authUserError } = await client.auth.admin.getUserById(updatedMembership.user_id);
    if (authUserError || !authUserData?.user) {
      return jsonResponse(
        {
          ok: false,
          error: "auth_get_user_failed",
          details: authUserError?.message ?? "user_not_found",
        },
        { status: 500 }
      );
    }

    const currentUser = authUserData.user as unknown as Record<string, unknown>;
    const currentUserMetadata = asObject(currentUser.user_metadata);
    const currentAppMetadata = asObject(currentUser.app_metadata);

    const userMetadataPayload: Record<string, unknown> = {
      ...currentUserMetadata,
    };
    if (nextRole) userMetadataPayload.crm_role = nextRole;
    if (body.full_name !== undefined) userMetadataPayload.full_name = nextFullName;
    if (grantedProvided) {
      userMetadataPayload.crm_permissions_granted = nextGranted ?? [];
      userMetadataPayload.crm_permissions = nextGranted ?? [];
    }
    if (revokedProvided) userMetadataPayload.crm_permissions_revoked = nextRevoked ?? [];

    const appMetadataPayload: Record<string, unknown> = {
      ...currentAppMetadata,
    };
    if (nextRole) appMetadataPayload.role = nextRole;

    const { data: updatedAuthData, error: updateAuthError } = await client.auth.admin.updateUserById(
      updatedMembership.user_id,
      {
        user_metadata: userMetadataPayload,
        app_metadata: appMetadataPayload,
      }
    );
    if (updateAuthError || !updatedAuthData?.user) {
      return jsonResponse(
        {
          ok: false,
          error: "auth_update_user_failed",
          details: updateAuthError?.message ?? "update_failed",
        },
        { status: 500 }
      );
    }
    updatedUser = updatedAuthData.user as unknown as Record<string, unknown>;
  }

  if (!mustUpdateUserMetadata && !Object.keys(membershipUpdatePayload).length) {
    return jsonResponse({ ok: false, error: "no_fields_to_update" }, { status: 422 });
  }

  if (!updatedUser) {
    const usersById = await loadAuthUsersById(client, [updatedMembership.user_id]);
    updatedUser = usersById.get(updatedMembership.user_id) ?? null;
  }

  return jsonResponse({
    ok: true,
    data: mapMembershipWithUser(updatedMembership, updatedUser),
    meta: {
      organization_id: organizationId,
      storage: "supabase.auth.users + crm.memberships + user_metadata.permissions",
    },
  });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await parseJsonBody<CreatePermissionsBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationIdHint = asText(body.organization_id);
  const email = asText(body.email)?.toLowerCase() ?? null;
  const password = asText(body.password);
  const fullName = asText(body.full_name);
  const role = normalizeRole(body.role) ?? "viewer";
  const isActive = body.is_active == null ? true : normalizeBoolean(body.is_active);
  const permissionsGranted = normalizeCrmPermissionList(body.permissions_granted);
  const permissionsRevoked = normalizeCrmPermissionList(body.permissions_revoked);

  if (!email) return jsonResponse({ ok: false, error: "email_required" }, { status: 422 });
  if (!password) return jsonResponse({ ok: false, error: "password_required" }, { status: 422 });
  if (password.length < 8) {
    return jsonResponse(
      {
        ok: false,
        error: "password_too_short",
        details: "Minimo 8 caracteres.",
      },
      { status: 422 }
    );
  }
  if (body.role != null && !normalizeRole(body.role)) {
    return jsonResponse({ ok: false, error: "invalid_role" }, { status: 422 });
  }
  if (body.is_active != null && isActive == null) {
    return jsonResponse({ ok: false, error: "invalid_is_active" }, { status: 422 });
  }

  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint,
    allowedRoles: CRM_ADMIN_ROLES,
    allowedPermissions: ["crm.users.manage"],
  });
  if (access.error || !access.data) {
    return jsonResponse(
      {
        ok: false,
        error: access.error?.error ?? "crm_auth_required",
        details: access.error?.details,
      },
      { status: access.error?.status ?? 401 }
    );
  }

  if (role === "owner" && access.data.role !== "owner") {
    return jsonResponse({ ok: false, error: "owner_role_requires_owner_actor" }, { status: 403 });
  }

  const organizationId = access.data.organization_id;
  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  let authUser = await findAuthUserByEmail(client, email);
  const isExisting = Boolean(authUser);

  if (!authUser) {
    const { data: createdData, error: createError } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName ?? email,
        crm_role: role,
        crm_permissions_granted: permissionsGranted,
        crm_permissions: permissionsGranted,
        crm_permissions_revoked: permissionsRevoked,
      },
      app_metadata: {
        role,
      },
    });

    if (createError || !createdData?.user) {
      const details = asText(createError?.message);
      return jsonResponse(
        {
          ok: false,
          error: isAlreadyRegisteredError(details) ? "email_already_registered" : "auth_create_user_failed",
          details,
        },
        { status: isAlreadyRegisteredError(details) ? 409 : 500 }
      );
    }

    authUser = createdData.user as unknown as Record<string, unknown>;
  } else {
    const currentUserMetadata = asObject(authUser.user_metadata);
    const currentAppMetadata = asObject(authUser.app_metadata);
    const mergedUserMetadata: Record<string, unknown> = {
      ...currentUserMetadata,
      full_name: fullName ?? asText(currentUserMetadata.full_name) ?? email,
      crm_role: role,
      crm_permissions_granted: permissionsGranted,
      crm_permissions: permissionsGranted,
      crm_permissions_revoked: permissionsRevoked,
    };
    const mergedAppMetadata: Record<string, unknown> = {
      ...currentAppMetadata,
      role,
    };

    const authUserId = asUuid(authUser.id);
    if (!authUserId) {
      return jsonResponse({ ok: false, error: "auth_user_invalid_shape" }, { status: 500 });
    }

    const { data: updatedData, error: updateError } = await client.auth.admin.updateUserById(authUserId, {
      password,
      email_confirm: true,
      user_metadata: mergedUserMetadata,
      app_metadata: mergedAppMetadata,
    });
    if (updateError || !updatedData?.user) {
      return jsonResponse(
        {
          ok: false,
          error: "auth_update_user_failed",
          details: updateError?.message ?? "update_failed",
        },
        { status: 500 }
      );
    }

    authUser = updatedData.user as unknown as Record<string, unknown>;
  }

  const targetUserId = asUuid(authUser.id);
  if (!targetUserId) return jsonResponse({ ok: false, error: "auth_user_invalid_shape" }, { status: 500 });

  let membership: MembershipRow;
  try {
    membership = await upsertMembership(client, {
      organizationId,
      userId: targetUserId,
      role,
      isActive: isActive ?? true,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : "membership_upsert_failed";
    return jsonResponse(
      {
        ok: false,
        error: "db_membership_upsert_error",
        details,
      },
      { status: 500 }
    );
  }

  return jsonResponse(
    {
      ok: true,
      data: mapMembershipWithUser(membership, authUser),
      meta: {
        action: isExisting ? "updated" : "created",
        organization_id: organizationId,
        storage: "supabase.auth.users + crm.memberships + user_metadata.permissions",
      },
    },
    { status: isExisting ? 200 : 201 }
  );
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "POST", "PATCH"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "POST", "PATCH"]);
