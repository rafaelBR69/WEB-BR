import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";
import {
  PORTAL_ACCOUNT_SELECT_COLUMNS,
  asText,
  asUuid,
  mapPortalAccountRow,
  toPositiveInt,
} from "@/utils/crmPortal";

type PatchPortalAccountBody = {
  organization_id?: string;
  portal_account_id?: string;
  status?: "pending" | "active" | "blocked" | "revoked";
};

const asPortalAccountStatus = (value: unknown) => {
  if (value === "pending" || value === "active" || value === "blocked" || value === "revoked") {
    return value;
  }
  return null;
};

export const GET: APIRoute = async ({ url }) => {
  const organizationId = asText(url.searchParams.get("organization_id"));
  const role = asText(url.searchParams.get("role"));
  const status = asPortalAccountStatus(asText(url.searchParams.get("status")));
  const q = asText(url.searchParams.get("q"))?.toLowerCase() ?? "";
  const page = toPositiveInt(url.searchParams.get("page"), 1, 1, 10000);
  const perPage = toPositiveInt(url.searchParams.get("per_page"), 25, 1, 200);

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
    .from("portal_accounts")
    .select(PORTAL_ACCOUNT_SELECT_COLUMNS, { count: "exact" })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (role) query = query.eq("role", role);
  if (status) query = query.eq("status", status);

  const { data, error, count } = await query;
  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_accounts_read_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  const rows = (data ?? []).map((row) => mapPortalAccountRow(row as Record<string, unknown>));
  const accountIds = rows
    .map((row) => asUuid(row.id))
    .filter((value): value is string => Boolean(value));

  const statsByAccount = new Map<
    string,
    {
      memberships_total: number;
      memberships_active: number;
      memberships_revoked: number;
      memberships_paused: number;
    }
  >();

  if (accountIds.length) {
    const { data: membershipsRaw, error: membershipsError } = await client
      .schema("crm")
      .from("portal_memberships")
      .select("portal_account_id, status")
      .eq("organization_id", organizationId)
      .in("portal_account_id", accountIds);

    if (membershipsError) {
      return jsonResponse(
        {
          ok: false,
          error: "db_portal_memberships_read_error",
          details: membershipsError.message,
        },
        { status: 500 }
      );
    }

    (membershipsRaw ?? []).forEach((item) => {
      const row = item as Record<string, unknown>;
      const portalAccountId = asUuid(row.portal_account_id);
      if (!portalAccountId) return;

      const current = statsByAccount.get(portalAccountId) ?? {
        memberships_total: 0,
        memberships_active: 0,
        memberships_revoked: 0,
        memberships_paused: 0,
      };
      current.memberships_total += 1;

      const membershipStatus = asText(row.status);
      if (membershipStatus === "active") current.memberships_active += 1;
      if (membershipStatus === "revoked") current.memberships_revoked += 1;
      if (membershipStatus === "paused") current.memberships_paused += 1;

      statsByAccount.set(portalAccountId, current);
    });
  }

  const filtered = rows
    .map((row) => ({
      ...row,
      membership_stats: statsByAccount.get(asUuid(row.id) ?? "") ?? {
        memberships_total: 0,
        memberships_active: 0,
        memberships_revoked: 0,
        memberships_paused: 0,
      },
    }))
    .filter((row) => {
      if (!q) return true;
      const roleText = asText(row.role) ?? "";
      const statusText = asText(row.status) ?? "";
      const emailText = asText((row.metadata as Record<string, unknown>)?.email) ?? "";
      const nameText = asText((row.metadata as Record<string, unknown>)?.full_name) ?? "";
      const idText = asText(row.id) ?? "";
      const composed = `${roleText} ${statusText} ${emailText} ${nameText} ${idText}`.toLowerCase();
      return composed.includes(q);
    });

  const total = typeof count === "number" ? count : filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return jsonResponse({
    ok: true,
    data: filtered,
    meta: {
      count: filtered.length,
      total,
      page,
      per_page: perPage,
      total_pages: totalPages,
      storage: "supabase.crm.portal_accounts + crm.portal_memberships",
    },
  });
};

export const PATCH: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<PatchPortalAccountBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationId = asText(body.organization_id);
  const portalAccountId = asUuid(body.portal_account_id);
  const status = asPortalAccountStatus(body.status);

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (!portalAccountId) return jsonResponse({ ok: false, error: "portal_account_id_required" }, { status: 422 });
  if (!status) return jsonResponse({ ok: false, error: "status_required" }, { status: 422 });

  if (!hasSupabaseServerClient()) {
    return jsonResponse(
      {
        ok: true,
        data: {
          id: portalAccountId,
          organization_id: organizationId,
          status,
        },
        meta: {
          persisted: false,
          storage: "mock_in_memory",
        },
      },
      { status: 200 }
    );
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const { data, error } = await client
    .schema("crm")
    .from("portal_accounts")
    .update({ status })
    .eq("organization_id", organizationId)
    .eq("id", portalAccountId)
    .select(PORTAL_ACCOUNT_SELECT_COLUMNS)
    .single();

  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_account_update_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  return jsonResponse({
    ok: true,
    data: mapPortalAccountRow(data as Record<string, unknown>),
    meta: {
      storage: "supabase.crm.portal_accounts",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
