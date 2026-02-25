import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";
import {
  PORTAL_MEMBERSHIP_SELECT_COLUMNS,
  asNumber,
  asObject,
  asText,
  asUuid,
  mapPortalMembershipRow,
  normalizePortalMembershipScope,
  toPositiveInt,
} from "@/utils/crmPortal";

type UpsertMembershipBody = {
  organization_id?: string;
  portal_account_id?: string;
  project_property_id?: string;
  access_scope?: "read" | "read_write" | "full";
  status?: "active" | "paused" | "revoked";
  dispute_window_hours?: number;
  permissions?: Record<string, unknown>;
  created_by?: string | null;
};

type PatchMembershipBody = {
  organization_id?: string;
  id?: string;
  access_scope?: "read" | "read_write" | "full";
  status?: "active" | "paused" | "revoked";
  dispute_window_hours?: number;
  permissions?: Record<string, unknown>;
};

const normalizeMembershipStatus = (value: unknown) => {
  if (value === "active" || value === "paused" || value === "revoked") return value;
  return "active";
};

const toDisputeWindowHours = (value: unknown) => {
  const parsed = asNumber(value);
  if (parsed == null) return 48;
  const floored = Math.floor(parsed);
  return Math.min(72, Math.max(24, floored));
};

const ensureProjectIsPromotion = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  organizationId: string,
  projectPropertyId: string
) => {
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

  return {
    ok: true as const,
    error: null as string | null,
    details: null as string | null,
    status: 200,
  };
};

export const GET: APIRoute = async ({ url }) => {
  const organizationId = asText(url.searchParams.get("organization_id"));
  const portalAccountId = asUuid(url.searchParams.get("portal_account_id"));
  const projectPropertyId = asUuid(url.searchParams.get("project_property_id"));
  const status = asText(url.searchParams.get("status"));
  const page = toPositiveInt(url.searchParams.get("page"), 1, 1, 10000);
  const perPage = toPositiveInt(url.searchParams.get("per_page"), 30, 1, 200);

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });

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
    .from("portal_memberships")
    .select(PORTAL_MEMBERSHIP_SELECT_COLUMNS, { count: "exact" })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (portalAccountId) query = query.eq("portal_account_id", portalAccountId);
  if (projectPropertyId) query = query.eq("project_property_id", projectPropertyId);
  if (status) query = query.eq("status", status);

  const { data, error, count } = await query;
  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_memberships_read_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  const rows = (data ?? []).map((row) => mapPortalMembershipRow(row as Record<string, unknown>));
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
      storage: "supabase.crm.portal_memberships",
    },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<UpsertMembershipBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationId = asText(body.organization_id);
  const portalAccountId = asUuid(body.portal_account_id);
  const projectPropertyId = asUuid(body.project_property_id);
  const accessScope = normalizePortalMembershipScope(body.access_scope);
  const status = normalizeMembershipStatus(body.status);
  const disputeWindowHours = toDisputeWindowHours(body.dispute_window_hours);
  const permissions = asObject(body.permissions);
  const createdBy = asUuid(body.created_by);

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (!portalAccountId) return jsonResponse({ ok: false, error: "portal_account_id_required" }, { status: 422 });
  if (!projectPropertyId) return jsonResponse({ ok: false, error: "project_property_id_required" }, { status: 422 });

  if (!hasSupabaseServerClient()) {
    return jsonResponse(
      {
        ok: true,
        data: {
          id: `pm_${crypto.randomUUID()}`,
          organization_id: organizationId,
          portal_account_id: portalAccountId,
          project_property_id: projectPropertyId,
          access_scope: accessScope,
          status,
          dispute_window_hours: disputeWindowHours,
          permissions,
        },
        meta: {
          persisted: false,
          storage: "mock_in_memory",
        },
      },
      { status: 201 }
    );
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

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

  const payload = {
    organization_id: organizationId,
    portal_account_id: portalAccountId,
    project_property_id: projectPropertyId,
    access_scope: accessScope,
    status,
    dispute_window_hours: disputeWindowHours,
    permissions,
    created_by: createdBy,
  };

  const { data, error } = await client
    .schema("crm")
    .from("portal_memberships")
    .upsert(payload, { onConflict: "portal_account_id,project_property_id" })
    .select(PORTAL_MEMBERSHIP_SELECT_COLUMNS)
    .single();

  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_membership_upsert_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  return jsonResponse(
    {
      ok: true,
      data: mapPortalMembershipRow(data as Record<string, unknown>),
      meta: {
        storage: "supabase.crm.portal_memberships",
      },
    },
    { status: 201 }
  );
};

export const PATCH: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<PatchMembershipBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationId = asText(body.organization_id);
  const membershipId = asUuid(body.id);
  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (!membershipId) return jsonResponse({ ok: false, error: "membership_id_required" }, { status: 422 });

  const updatePayload: Record<string, unknown> = {};
  if (body.access_scope != null) updatePayload.access_scope = normalizePortalMembershipScope(body.access_scope);
  if (body.status != null) updatePayload.status = normalizeMembershipStatus(body.status);
  if (body.dispute_window_hours != null) updatePayload.dispute_window_hours = toDisputeWindowHours(body.dispute_window_hours);
  if (body.permissions != null) updatePayload.permissions = asObject(body.permissions);

  if (!Object.keys(updatePayload).length) {
    return jsonResponse({ ok: false, error: "no_fields_to_update" }, { status: 422 });
  }

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: {
        id: membershipId,
        organization_id: organizationId,
        ...updatePayload,
      },
      meta: {
        persisted: false,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const { data, error } = await client
    .schema("crm")
    .from("portal_memberships")
    .update(updatePayload)
    .eq("organization_id", organizationId)
    .eq("id", membershipId)
    .select(PORTAL_MEMBERSHIP_SELECT_COLUMNS)
    .single();

  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_membership_update_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  return jsonResponse({
    ok: true,
    data: mapPortalMembershipRow(data as Record<string, unknown>),
    meta: {
      storage: "supabase.crm.portal_memberships",
    },
  });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const body = await parseJsonBody<{ organization_id?: string; id?: string }>(request);
  const organizationId = asText(body?.organization_id) ?? asText(url.searchParams.get("organization_id"));
  const membershipId = asUuid(body?.id) ?? asUuid(url.searchParams.get("id"));

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (!membershipId) return jsonResponse({ ok: false, error: "membership_id_required" }, { status: 422 });

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: {
        id: membershipId,
        organization_id: organizationId,
        status: "revoked",
      },
      meta: {
        persisted: false,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const { data, error } = await client
    .schema("crm")
    .from("portal_memberships")
    .update({ status: "revoked" })
    .eq("organization_id", organizationId)
    .eq("id", membershipId)
    .select(PORTAL_MEMBERSHIP_SELECT_COLUMNS)
    .single();

  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_membership_revoke_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  return jsonResponse({
    ok: true,
    data: mapPortalMembershipRow(data as Record<string, unknown>),
    meta: {
      storage: "supabase.crm.portal_memberships",
    },
  });
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "POST", "PATCH", "DELETE"]);
