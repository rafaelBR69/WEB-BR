import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@shared/supabase/server";
import { CRM_ADMIN_ROLES, resolveCrmOrgAccess } from "@shared/crm/access";
import { isPortalMockFallbackEnabled, portalMockFallbackDisabledResponse } from "@shared/http/portal/mockFallback";
import {
  asNumber,
  asObject,
  asTextArray,
  asText,
  asUuid,
  defaultMembershipScopeForRole,
  extractPortalProfile,
  generateInviteCode,
  getRequestIp,
  getRequestUserAgent,
  hashInviteCode,
  mapPortalInviteRow,
  normalizePortalRole,
  safeInsertPortalAccessLog,
  toPositiveInt,
} from "@shared/portal/domain";
import { sendPortalApprovalEmail } from "@shared/portal/email";

type ReviewRegistrationRequestBody = {
  organization_id?: string;
  request_id?: string;
  action?: "approve" | "reject";
  role?: "portal_agent_admin" | "portal_agent_member" | "portal_client";
  access_mode?: "all" | "selected";
  project_property_ids?: string[] | null;
  project_property_id?: string | null;
  access_scope?: "read" | "read_write" | "full" | null;
  status?: "pending" | "active" | "blocked" | "revoked" | null;
  expires_hours?: number | null;
  max_attempts?: number | null;
  review_notes?: string | null;
  reviewed_by?: string | null;
};

const isAlreadyRegisteredError = (details: string | null): boolean => {
  const normalized = String(details ?? "").toLowerCase();
  return normalized.includes("already registered") || normalized.includes("already been registered");
};

const normalizeAccessMode = (value: unknown): "all" | "selected" => {
  if (value === "all") return "all";
  return "selected";
};

const normalizePortalAccountStatus = (value: unknown): "pending" | "active" | "blocked" | "revoked" => {
  if (value === "active" || value === "blocked" || value === "revoked") return value;
  return "pending";
};

const normalizeMembershipScope = (value: unknown, role: "portal_agent_admin" | "portal_agent_member" | "portal_client") => {
  if (value === "read" || value === "read_write" || value === "full") return value;
  return defaultMembershipScopeForRole(role);
};

const resolveInviteTypeFromRole = (role: "portal_agent_admin" | "portal_agent_member" | "portal_client") =>
  role === "portal_client" ? "client" : "agent";

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

const buildTemporaryPassword = () => {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const base = Array.from(bytes, (byte) => byte.toString(36)).join("");
  return `BRtmp!${base.slice(0, 18)}9`;
};

const dedupeProjectIds = (values: Array<string | null | undefined>) =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))));

const buildApprovedProjectIds = (body: ReviewRegistrationRequestBody, requestRecord: Record<string, unknown>) => {
  const fromBody = asTextArray(body.project_property_ids).map((value) => asUuid(value)).filter((value): value is string => Boolean(value));
  const single = asUuid(body.project_property_id) ?? asUuid(requestRecord.project_property_id);
  return dedupeProjectIds(single ? [single, ...fromBody] : fromBody);
};

const buildPortalAccountMetadata = ({
  existingMetadata,
  requester,
  requestId,
  approvalInviteId,
  actorUserId,
  accessMode,
  approvedProjectIds,
}: {
  existingMetadata: Record<string, unknown>;
  requester: Record<string, unknown>;
  requestId: string;
  approvalInviteId: string | null;
  actorUserId: string | null;
  accessMode: "all" | "selected";
  approvedProjectIds: string[];
}) => {
  const profile = extractPortalProfile(requester);
  return {
    ...existingMetadata,
    email: profile.email,
    full_name: profile.full_name,
    professional_type: profile.professional_type,
    company_name: profile.company_name,
    commercial_name: profile.commercial_name,
    legal_name: profile.legal_name,
    cif: profile.cif,
    phone: profile.phone,
    language: profile.language,
    notes: profile.notes,
    registration_request_id: requestId,
    approval_invite_id: approvalInviteId,
    approved_by: actorUserId,
    approved_at: new Date().toISOString(),
    access_mode: accessMode,
    approved_project_property_ids: approvedProjectIds,
    requester,
  };
};

const normalizeApprovalStatusFilter = (value: string | null) => {
  if (!value || value === "requested") return "requested";
  if (value === "approved" || value === "rejected" || value === "all") return value;
  return "requested";
};

const normalizeAction = (value: unknown): "approve" | "reject" | null => {
  if (value === "approve" || value === "reject") return value;
  return null;
};

const buildExpiresAt = (hoursInput: number | null) => {
  const normalized = Number.isFinite(hoursInput as number) ? Math.floor(hoursInput as number) : 72;
  const bounded = Math.min(24 * 30, Math.max(1, normalized));
  return new Date(Date.now() + bounded * 60 * 60 * 1000).toISOString();
};

const buildMaxAttempts = (value: number | null) => {
  const normalized = Number.isFinite(value as number) ? Math.floor(value as number) : 5;
  return Math.min(20, Math.max(1, normalized));
};

const isSelfSignupRequest = (row: Record<string, unknown>): boolean => {
  const metadata = asObject(row.metadata);
  return asText(metadata.request_type) === "self_signup";
};

const getRequestApprovalStatus = (row: Record<string, unknown>): string => {
  const metadata = asObject(row.metadata);
  return asText(metadata.approval_status) ?? "requested";
};

const ensureProjectIsPromotion = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  organizationId: string,
  projectPropertyId: string | null
) => {
  if (!client || !projectPropertyId) return { ok: true as const, error: null as string | null, details: null as string | null };

  const { data, error } = await client
    .schema("crm")
    .from("properties")
    .select("id, record_type")
    .eq("organization_id", organizationId)
    .eq("id", projectPropertyId)
    .maybeSingle();

  if (error) {
    return {
      ok: false as const,
      error: "db_project_property_read_error",
      details: error.message,
      status: 500,
    };
  }

  if (!data) {
    return {
      ok: false as const,
      error: "project_property_not_found",
      details: null,
      status: 422,
    };
  }

  if (asText((data as Record<string, unknown>).record_type) !== "project") {
    return {
      ok: false as const,
      error: "project_property_must_be_project",
      details: null,
      status: 422,
    };
  }

  return { ok: true as const, error: null as string | null, details: null as string | null, status: 200 };
};

const mapRequestRow = (row: Record<string, unknown>) => {
  const mapped = mapPortalInviteRow(row);
  const metadata = asObject(row.metadata);
  const requester = asObject(metadata.requester);

  return {
    ...mapped,
    request: {
      approval_status: asText(metadata.approval_status) ?? "requested",
      requested_at: asText(metadata.requested_at) ?? asText(row.created_at),
      reviewed_at: asText(metadata.reviewed_at),
      reviewed_by: asText(metadata.reviewed_by),
      review_notes: asText(metadata.review_notes),
      approved_invite_id: asText(metadata.approved_invite_id),
      requester: {
        professional_type: asText(requester.professional_type) ?? "company",
        full_name: asText(requester.full_name),
        email: asText(requester.email),
        company_name: asText(requester.company_name),
        commercial_name: asText(requester.commercial_name),
        legal_name: asText(requester.legal_name),
        cif: asText(requester.cif),
        phone: asText(requester.phone),
        language: asText(requester.language),
        notes: asText(requester.notes),
      },
    },
  };
};

export const GET: APIRoute = async ({ url, cookies }) => {
  const organizationId = asText(url.searchParams.get("organization_id"));
  const email = asText(url.searchParams.get("email"))?.toLowerCase() ?? null;
  const approvalStatus = normalizeApprovalStatusFilter(asText(url.searchParams.get("approval_status")));
  const page = toPositiveInt(url.searchParams.get("page"), 1, 1, 10000);
  const perPage = toPositiveInt(url.searchParams.get("per_page"), 25, 1, 200);

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint: organizationId,
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

  if (!hasSupabaseServerClient()) {
    if (!isPortalMockFallbackEnabled()) {
      return portalMockFallbackDisabledResponse(
        "portal_registration_requests_backend_unavailable",
        "Activa Supabase o habilita CRM_ENABLE_MOCK_FALLBACKS=true solo en desarrollo para usar mocks."
      );
    }
    return jsonResponse({
      ok: true,
      data: [],
      meta: {
        count: 0,
        total: 0,
        page,
        per_page: perPage,
        total_pages: 1,
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
    .from("portal_invites")
    .select("*", { count: "exact" })
    .eq("organization_id", organizationId)
    .eq("invite_type", "client")
    .eq("role", "portal_client")
    .contains("metadata", { request_type: "self_signup" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (email) query = query.eq("email_normalized", email);

  if (approvalStatus === "requested") {
    query = query.eq("status", "pending").contains("metadata", { approval_status: "requested" });
  } else if (approvalStatus === "approved") {
    query = query.eq("status", "revoked").contains("metadata", { approval_status: "approved" });
  } else if (approvalStatus === "rejected") {
    query = query.eq("status", "revoked").contains("metadata", { approval_status: "rejected" });
  }

  const { data, error, count } = await query;
  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_registration_requests_read_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((row) => mapRequestRow(row));
  const total = typeof count === "number" ? count : rows.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return jsonResponse({
    ok: true,
    data: rows,
    meta: {
      count: rows.length,
      total,
      page,
      per_page: perPage,
      total_pages: totalPages,
      storage: "supabase.crm.portal_invites",
    },
  });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await parseJsonBody<ReviewRegistrationRequestBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationId = asText(body.organization_id);
  const requestId = asUuid(body.request_id);
  const action = normalizeAction(body.action);
  const reviewNotes = asText(body.review_notes);
  const reviewedBy = asText(body.reviewed_by);

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (!requestId) return jsonResponse({ ok: false, error: "request_id_required" }, { status: 422 });
  if (!action) return jsonResponse({ ok: false, error: "action_required" }, { status: 422 });
  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint: organizationId,
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
  const reviewedByUserId = reviewedBy ?? access.data.auth_user_id;

  if (!hasSupabaseServerClient()) {
    if (!isPortalMockFallbackEnabled()) {
      return portalMockFallbackDisabledResponse(
        "portal_registration_requests_backend_unavailable",
        "Activa Supabase o habilita CRM_ENABLE_MOCK_FALLBACKS=true solo en desarrollo para usar mocks."
      );
    }
    return jsonResponse({
      ok: true,
      data: {
        request_id: requestId,
        organization_id: organizationId,
        action,
      },
      meta: {
        persisted: false,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const { data: requestRow, error: requestError } = await client
    .schema("crm")
    .from("portal_invites")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", requestId)
    .maybeSingle();

  if (requestError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_registration_request_read_error",
        details: requestError.message,
      },
      { status: 500 }
    );
  }

  if (!requestRow) return jsonResponse({ ok: false, error: "registration_request_not_found" }, { status: 404 });

  const requestRecord = requestRow as Record<string, unknown>;
  const requestEmail = asText(requestRecord.email)?.toLowerCase() ?? null;
  if (!requestEmail) return jsonResponse({ ok: false, error: "registration_request_email_missing" }, { status: 422 });

  if (!isSelfSignupRequest(requestRecord)) {
    return jsonResponse({ ok: false, error: "invalid_registration_request_type" }, { status: 422 });
  }
  if (asText(requestRecord.invite_type) !== "client" || asText(requestRecord.role) !== "portal_client") {
    return jsonResponse({ ok: false, error: "invalid_registration_request_scope" }, { status: 422 });
  }

  const requestStatus = asText(requestRecord.status);
  const approvalStatus = getRequestApprovalStatus(requestRecord);
  if (requestStatus !== "pending" || approvalStatus !== "requested") {
    return jsonResponse({ ok: false, error: "registration_request_already_reviewed" }, { status: 409 });
  }

  const nowIso = new Date().toISOString();
  const requestMetadata = asObject(requestRecord.metadata);
  const requester = asObject(requestMetadata.requester);

  if (action === "reject") {
    const { data: rejectedRow, error: rejectError } = await client
      .schema("crm")
      .from("portal_invites")
      .update({
        status: "revoked",
        revoked_at: nowIso,
        metadata: {
          ...requestMetadata,
          approval_status: "rejected",
          reviewed_at: nowIso,
          reviewed_by: reviewedByUserId,
          review_notes: reviewNotes,
        },
      })
      .eq("organization_id", organizationId)
      .eq("id", requestId)
      .select("*")
      .single();

    if (rejectError) {
      return jsonResponse(
        {
          ok: false,
          error: "db_portal_registration_request_reject_error",
          details: rejectError.message,
        },
        { status: 500 }
      );
    }

    await safeInsertPortalAccessLog(client, {
      organization_id: organizationId,
      email: requestEmail,
      project_property_id: asText(requestRecord.project_property_id),
      event_type: "invite_revoked",
      ip: getRequestIp(request),
      user_agent: getRequestUserAgent(request),
      metadata: {
        registration_request_id: requestId,
        review_action: "reject",
        reviewed_by: reviewedByUserId,
      },
    });

    return jsonResponse({
      ok: true,
      data: {
        request: mapRequestRow(rejectedRow as Record<string, unknown>),
        invite: null,
      },
      meta: {
        persisted: true,
        storage: "supabase.crm.portal_invites",
      },
    });
  }

  const role = normalizePortalRole(body.role);
  const accessMode = role === "portal_agent_admin" ? "all" : normalizeAccessMode(body.access_mode);
  const accountStatus = normalizePortalAccountStatus(body.status);
  const membershipScope = normalizeMembershipScope(body.access_scope, role);
  const approvedProjectIds = buildApprovedProjectIds(body, requestRecord);
  const inviteProjectId = role === "portal_agent_admin" ? null : approvedProjectIds[0] ?? null;

  if (role !== "portal_agent_admin" && !approvedProjectIds.length) {
    return jsonResponse({ ok: false, error: "project_property_ids_required_for_limited_access" }, { status: 422 });
  }
  if (accessMode === "selected" && role === "portal_agent_admin") {
    return jsonResponse({ ok: false, error: "portal_agent_admin_must_use_all_access" }, { status: 422 });
  }

  for (const candidateProjectId of approvedProjectIds) {
    const projectValidation = await ensureProjectIsPromotion(client, organizationId, candidateProjectId);
    if (!projectValidation.ok) {
      return jsonResponse(
        {
          ok: false,
          error: projectValidation.error,
          details: projectValidation.details,
        },
        { status: projectValidation.status }
      );
    }
  }

  const inviteCode = generateInviteCode(8);
  const codeHash = await hashInviteCode(inviteCode);
  const expiresAt = buildExpiresAt(asNumber(body.expires_hours));
  const maxAttempts = buildMaxAttempts(asNumber(body.max_attempts));

  let authUser: Record<string, unknown> | null = null;
  try {
    authUser = await findAuthUserByEmail(client, requestEmail);
  } catch (error) {
    const details = error instanceof Error ? error.message : "auth_list_users_error";
    return jsonResponse({ ok: false, error: "auth_lookup_failed", details }, { status: 500 });
  }

  if (!authUser) {
    const createdUser = await client.auth.admin.createUser({
      email: requestEmail,
      password: buildTemporaryPassword(),
      email_confirm: true,
      user_metadata: {
        full_name: asText(requester.full_name) ?? requestEmail,
        portal_organization_id: organizationId,
        portal_pending_activation: true,
      },
      app_metadata: {
        portal_role: role,
      },
    });

    if (createdUser.error || !createdUser.data?.user) {
      const details = asText(createdUser.error?.message);
      return jsonResponse(
        {
          ok: false,
          error: isAlreadyRegisteredError(details) ? "email_already_registered" : "auth_create_user_failed",
          details,
        },
        { status: isAlreadyRegisteredError(details) ? 409 : 500 }
      );
    }

    authUser = createdUser.data.user as unknown as Record<string, unknown>;
  }

  const authUserId = asUuid(authUser.id);
  if (!authUserId) {
    return jsonResponse({ ok: false, error: "auth_user_invalid_shape" }, { status: 500 });
  }

  const { data: existingAccountRow, error: existingAccountError } = await client
    .schema("crm")
    .from("portal_accounts")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (existingAccountError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_account_read_error",
        details: existingAccountError.message,
      },
      { status: 500 }
    );
  }

  const existingAccountRecord = (existingAccountRow as Record<string, unknown> | null) ?? null;
  if (existingAccountRecord && asText(existingAccountRecord.status) === "active") {
    return jsonResponse({ ok: false, error: "portal_account_already_active_for_email" }, { status: 409 });
  }

  const approvalInviteMetadata = {
    source: "self_signup_approval",
    approval_status: "approved",
    registration_request_id: requestId,
    approved_at: nowIso,
    approved_by: reviewedByUserId,
    access_mode: accessMode,
    approved_project_property_ids: approvedProjectIds,
    requester,
  };

  const approvalInvitePayload = {
    organization_id: organizationId,
    email: requestEmail,
    invite_type: resolveInviteTypeFromRole(role),
    role,
    project_property_id: inviteProjectId,
    code_hash: codeHash,
    code_last4: inviteCode.slice(-4),
    status: "pending",
    expires_at: expiresAt,
    max_attempts: maxAttempts,
    metadata: approvalInviteMetadata,
  };

  const { data: approvalInviteRow, error: approvalInviteError } = await client
    .schema("crm")
    .from("portal_invites")
    .insert(approvalInvitePayload)
    .select("*")
    .single();

  if (approvalInviteError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_approval_invite_insert_error",
        details: approvalInviteError.message,
      },
      { status: 500 }
    );
  }

  const approvedInviteId = asUuid((approvalInviteRow as Record<string, unknown>).id);
  if (!approvedInviteId) {
    return jsonResponse({ ok: false, error: "approval_invite_id_missing" }, { status: 500 });
  }

  const accountMetadata = buildPortalAccountMetadata({
    existingMetadata: asObject(existingAccountRecord?.metadata),
    requester,
    requestId,
    approvalInviteId: approvedInviteId,
    actorUserId: reviewedByUserId,
    accessMode,
    approvedProjectIds,
  });

  const portalAccountPayload = {
    organization_id: organizationId,
    auth_user_id: authUserId,
    role,
    status: accountStatus,
    metadata: accountMetadata,
    created_by: access.data.auth_user_id,
  };

  const { data: portalAccountRow, error: portalAccountError } = await client
    .schema("crm")
    .from("portal_accounts")
    .upsert(portalAccountPayload, { onConflict: "organization_id,auth_user_id" })
    .select("*")
    .single();

  if (portalAccountError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_account_upsert_error",
        details: portalAccountError.message,
      },
      { status: 500 }
    );
  }

  const portalAccountId = asUuid((portalAccountRow as Record<string, unknown>).id);
  if (!portalAccountId) {
    return jsonResponse({ ok: false, error: "portal_account_id_missing" }, { status: 500 });
  }

  const { error: approvalInviteLinkError } = await client
    .schema("crm")
    .from("portal_invites")
    .update({
      metadata: {
        ...approvalInviteMetadata,
        portal_account_id: portalAccountId,
      },
    })
    .eq("organization_id", organizationId)
    .eq("id", approvedInviteId);

  if (approvalInviteLinkError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_approval_invite_update_error",
        details: approvalInviteLinkError.message,
      },
      { status: 500 }
    );
  }

  if (role !== "portal_agent_admin") {
    const { data: currentMembershipRows, error: currentMembershipsError } = await client
      .schema("crm")
      .from("portal_memberships")
      .select("id, project_property_id")
      .eq("organization_id", organizationId)
      .eq("portal_account_id", portalAccountId);

    if (currentMembershipsError) {
      return jsonResponse(
        {
          ok: false,
          error: "db_portal_membership_sync_error",
          details: currentMembershipsError.message,
        },
        { status: 500 }
      );
    }

    const membershipsToRevoke = ((currentMembershipRows ?? []) as Array<Record<string, unknown>>)
      .map((entry) => ({
        id: asUuid(entry.id),
        project_property_id: asUuid(entry.project_property_id),
      }))
      .filter(
        (entry): entry is { id: string; project_property_id: string | null } =>
          Boolean(entry.id) && !approvedProjectIds.includes(entry.project_property_id ?? "")
      )
      .map((entry) => entry.id);

    if (membershipsToRevoke.length) {
      const { error: revokeOtherMembershipsError } = await client
        .schema("crm")
        .from("portal_memberships")
        .update({ status: "revoked", revoked_at: nowIso })
        .eq("organization_id", organizationId)
        .in("id", membershipsToRevoke);

      if (revokeOtherMembershipsError) {
        return jsonResponse(
          {
            ok: false,
            error: "db_portal_membership_sync_error",
            details: revokeOtherMembershipsError.message,
          },
          { status: 500 }
        );
      }
    }

    const membershipPayloads = approvedProjectIds.map((candidateProjectId) => ({
      organization_id: organizationId,
      portal_account_id: portalAccountId,
      project_property_id: candidateProjectId,
      access_scope: membershipScope,
      status: "active",
      dispute_window_hours: 48,
      permissions: {},
      created_by: access.data.auth_user_id,
    }));

    const { error: membershipsError } = await client
      .schema("crm")
      .from("portal_memberships")
      .upsert(membershipPayloads, { onConflict: "portal_account_id,project_property_id" });

    if (membershipsError) {
      return jsonResponse(
        {
          ok: false,
          error: "db_portal_membership_upsert_error",
          details: membershipsError.message,
        },
        { status: 500 }
      );
    }
  }

  const { data: reviewedRequestRow, error: reviewedRequestError } = await client
    .schema("crm")
    .from("portal_invites")
    .update({
      status: "revoked",
      revoked_at: nowIso,
      metadata: {
        ...requestMetadata,
        approval_status: "approved",
        reviewed_at: nowIso,
        reviewed_by: reviewedByUserId,
        review_notes: reviewNotes,
        approved_invite_id: approvedInviteId,
        approved_portal_account_id: portalAccountId,
        approved_role: role,
        access_mode: accessMode,
        approved_project_property_ids: approvedProjectIds,
      },
    })
    .eq("organization_id", organizationId)
    .eq("id", requestId)
    .select("*")
    .single();

  if (reviewedRequestError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_registration_request_update_error",
        details: reviewedRequestError.message,
      },
      { status: 500 }
    );
  }

  await safeInsertPortalAccessLog(client, {
    organization_id: organizationId,
    email: requestEmail,
    portal_account_id: portalAccountId,
    project_property_id: inviteProjectId,
    event_type: "invite_sent",
    ip: getRequestIp(request),
    user_agent: getRequestUserAgent(request),
    metadata: {
      registration_request_id: requestId,
      review_action: "approve",
      approved_invite_id: approvedInviteId,
      portal_account_id: portalAccountId,
      role,
      access_mode: accessMode,
      approved_project_property_ids: approvedProjectIds,
      reviewed_by: reviewedByUserId,
    },
  });

  const approvalEmail = await sendPortalApprovalEmail({
    request,
    email: requestEmail,
    organizationId,
    language: asText(requester.language),
    fullName: asText(requester.full_name),
    projectPropertyId: inviteProjectId,
    oneTimeCode: inviteCode,
  });

  if (!approvalEmail.sent) {
    console.warn("[crm-portal-registration-requests] approval email not sent", {
      requestId,
      email: requestEmail,
      provider: approvalEmail.provider,
      mode: approvalEmail.mode ?? null,
      error: approvalEmail.error,
    });
  }

  return jsonResponse(
    {
      ok: true,
      data: {
        request: mapRequestRow(reviewedRequestRow as Record<string, unknown>),
        invite: mapPortalInviteRow(approvalInviteRow as Record<string, unknown>),
        portal_account_id: portalAccountId,
        one_time_code: inviteCode,
      },
      meta: {
        persisted: true,
        storage: "supabase.crm.portal_invites",
        approval_email: approvalEmail,
      },
    },
    { status: 201 }
  );
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
