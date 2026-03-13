import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@shared/supabase/server";
import { CRM_ADMIN_ROLES, resolveCrmOrgAccess } from "@shared/crm/access";
import {
  asNumber,
  asObject,
  asText,
  asUuid,
  generateInviteCode,
  getRequestIp,
  getRequestUserAgent,
  hashInviteCode,
  mapPortalInviteRow,
  safeInsertPortalAccessLog,
  toPositiveInt,
} from "@shared/portal/domain";
import { sendPortalApprovalEmail } from "@shared/portal/email";

type ReviewRegistrationRequestBody = {
  organization_id?: string;
  request_id?: string;
  action?: "approve" | "reject";
  project_property_id?: string | null;
  expires_hours?: number | null;
  max_attempts?: number | null;
  review_notes?: string | null;
  reviewed_by?: string | null;
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

  if (!hasSupabaseServerClient()) {
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
          reviewed_by: reviewedBy,
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
        reviewed_by: reviewedBy,
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

  const projectPropertyId = asUuid(body.project_property_id) ?? asUuid(requestRecord.project_property_id);
  const projectValidation = await ensureProjectIsPromotion(client, organizationId, projectPropertyId);
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

  const inviteCode = generateInviteCode(8);
  const codeHash = await hashInviteCode(inviteCode);
  const expiresAt = buildExpiresAt(asNumber(body.expires_hours));
  const maxAttempts = buildMaxAttempts(asNumber(body.max_attempts));

  const approvalInvitePayload = {
    organization_id: organizationId,
    email: requestEmail,
    invite_type: "client",
    role: "portal_client",
    project_property_id: projectPropertyId,
    code_hash: codeHash,
    code_last4: inviteCode.slice(-4),
    status: "pending",
    expires_at: expiresAt,
    max_attempts: maxAttempts,
    metadata: {
      source: "self_signup_approval",
      approval_status: "approved",
      registration_request_id: requestId,
      approved_at: nowIso,
      approved_by: reviewedBy,
    },
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
        reviewed_by: reviewedBy,
        review_notes: reviewNotes,
        approved_invite_id: approvedInviteId,
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
    project_property_id: projectPropertyId,
    event_type: "invite_sent",
    ip: getRequestIp(request),
    user_agent: getRequestUserAgent(request),
    metadata: {
      registration_request_id: requestId,
      review_action: "approve",
      approved_invite_id: approvedInviteId,
      reviewed_by: reviewedBy,
    },
  });

  const approvalEmail = await sendPortalApprovalEmail({
    request,
    email: requestEmail,
    organizationId,
    language: asText(requester.language),
    fullName: asText(requester.full_name),
    projectPropertyId,
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
