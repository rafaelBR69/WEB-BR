import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";
import {
  asNumber,
  asObject,
  asText,
  asUuid,
  generateInviteCode,
  getRequestIp,
  getRequestUserAgent,
  hashInviteCode,
  inviteTypeMatchesRole,
  mapPortalInviteRow,
  normalizePortalInviteType,
  normalizePortalRole,
  safeInsertPortalAccessLog,
  toPositiveInt,
} from "@/utils/crmPortal";

type CreatePortalInviteBody = {
  organization_id?: string;
  email?: string;
  invite_type?: "agent" | "client";
  role?: "portal_agent_admin" | "portal_agent_member" | "portal_client";
  project_property_id?: string | null;
  expires_hours?: number | null;
  max_attempts?: number | null;
  metadata?: Record<string, unknown> | null;
  created_by?: string | null;
  code?: string | null;
};

const normalizeInviteStatusFilter = (value: string | null) => {
  if (!value) return null;
  if (value === "pending" || value === "used" || value === "expired" || value === "revoked" || value === "blocked") {
    return value;
  }
  return null;
};

const toInviteCode = (value: string | null) => {
  const normalized = value?.trim().toUpperCase() ?? "";
  return normalized.length ? normalized : generateInviteCode(8);
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

  return { ok: true as const, error: null as string | null, details: null as string | null };
};

export const GET: APIRoute = async ({ url }) => {
  const organizationId = asText(url.searchParams.get("organization_id"));
  const status = normalizeInviteStatusFilter(asText(url.searchParams.get("status")));
  const projectPropertyId = asUuid(url.searchParams.get("project_property_id"));
  const emailFilter = asText(url.searchParams.get("email"))?.toLowerCase() ?? null;
  const page = toPositiveInt(url.searchParams.get("page"), 1, 1, 10000);
  const perPage = toPositiveInt(url.searchParams.get("per_page"), 30, 1, 200);

  if (!organizationId) {
    return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
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
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) {
    return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });
  }

  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let query = client
    .schema("crm")
    .from("portal_invites")
    .select("*", { count: "exact" })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (status) query = query.eq("status", status);
  if (projectPropertyId) query = query.eq("project_property_id", projectPropertyId);
  if (emailFilter) query = query.eq("email_normalized", emailFilter);

  const { data, error, count } = await query;
  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_invites_read_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  const rows = (data ?? []).map((row) => mapPortalInviteRow(row as Record<string, unknown>));
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

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<CreatePortalInviteBody>(request);
  if (!body) {
    return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });
  }

  const organizationId = asText(body.organization_id);
  const email = asText(body.email)?.toLowerCase() ?? null;
  const inviteType = normalizePortalInviteType(body.invite_type);
  const role = normalizePortalRole(body.role);
  const projectPropertyId = asUuid(body.project_property_id);
  const metadata = asObject(body.metadata);
  const createdBy = asUuid(body.created_by);
  const expiresAt = buildExpiresAt(asNumber(body.expires_hours));
  const maxAttempts = buildMaxAttempts(asNumber(body.max_attempts));
  const inviteCode = toInviteCode(asText(body.code));
  const codeLast4 = inviteCode.slice(-4);

  if (!organizationId) {
    return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  }

  if (!email) {
    return jsonResponse({ ok: false, error: "email_required" }, { status: 422 });
  }

  if (!inviteTypeMatchesRole(inviteType, role)) {
    return jsonResponse(
      {
        ok: false,
        error: "invite_type_role_mismatch",
      },
      { status: 422 }
    );
  }

  if (!hasSupabaseServerClient()) {
    return jsonResponse(
      {
        ok: true,
        data: {
          id: `inv_${crypto.randomUUID()}`,
          organization_id: organizationId,
          email,
          invite_type: inviteType,
          role,
          project_property_id: projectPropertyId,
          status: "pending",
          expires_at: expiresAt,
          max_attempts: maxAttempts,
          attempt_count: 0,
          code_last4: codeLast4,
          metadata,
        },
        meta: {
          persisted: false,
          storage: "mock_in_memory",
          one_time_code: inviteCode,
        },
      },
      { status: 201 }
    );
  }

  const client = getSupabaseServerClient();
  if (!client) {
    return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });
  }

  const projectValidation = await ensureProjectIsPromotion(client, organizationId, projectPropertyId);
  if (!projectValidation.ok) {
    return jsonResponse(
      {
        ok: false,
        error: projectValidation.error,
        details: projectValidation.details,
      },
      { status: projectValidation.status ?? 422 }
    );
  }

  const codeHash = await hashInviteCode(inviteCode);

  const payload = {
    organization_id: organizationId,
    email,
    invite_type: inviteType,
    role,
    project_property_id: projectPropertyId,
    code_hash: codeHash,
    code_last4: codeLast4,
    status: "pending",
    expires_at: expiresAt,
    max_attempts: maxAttempts,
    metadata,
    created_by: createdBy,
  };

  const { data, error } = await client
    .schema("crm")
    .from("portal_invites")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_invites_insert_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  await safeInsertPortalAccessLog(client, {
    organization_id: organizationId,
    project_property_id: projectPropertyId,
    email,
    event_type: "invite_sent",
    ip: getRequestIp(request),
    user_agent: getRequestUserAgent(request),
    metadata: {
      invite_id: (data as Record<string, unknown>).id ?? null,
      invite_type: inviteType,
      role,
      created_by: createdBy,
    },
  });

  return jsonResponse(
    {
      ok: true,
      data: mapPortalInviteRow(data as Record<string, unknown>),
      meta: {
        persisted: true,
        storage: "supabase.crm.portal_invites",
        one_time_code: inviteCode,
      },
    },
    { status: 201 }
  );
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
