import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { getSupabaseServerAuthClient, getSupabaseServerClient } from "@shared/supabase/server";
import { PORTAL_ACCOUNT_SELECT_COLUMNS, asText, asUuid, mapPortalAccountRow } from "@shared/portal/domain";

type PortalRefreshBody = {
  refresh_token?: string;
  organization_id?: string | null;
};

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<PortalRefreshBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const refreshToken = asText(body.refresh_token);
  const organizationIdHint = asUuid(body.organization_id);
  if (!refreshToken) {
    return jsonResponse({ ok: false, error: "refresh_token_required" }, { status: 422 });
  }

  const authClient = getSupabaseServerAuthClient();
  const serviceClient = getSupabaseServerClient();
  if (!authClient || !serviceClient) {
    return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });
  }

  const { data: refreshData, error: refreshError } = await authClient.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (refreshError || !refreshData.session || !refreshData.user) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_refresh_token",
        details: refreshError?.message,
      },
      { status: 401 }
    );
  }

  const authUserId = asUuid(refreshData.user.id);
  if (!authUserId) {
    return jsonResponse({ ok: false, error: "invalid_auth_user_id" }, { status: 401 });
  }

  let accountQuery = serviceClient
    .schema("crm")
    .from("portal_accounts")
    .select(PORTAL_ACCOUNT_SELECT_COLUMNS)
    .eq("auth_user_id", authUserId)
    .order("created_at", { ascending: true });

  if (organizationIdHint) {
    accountQuery = accountQuery.eq("organization_id", organizationIdHint);
  }

  const { data: accountRows, error: accountError } = await accountQuery;
  if (accountError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_account_read_error",
        details: accountError.message,
      },
      { status: 500 }
    );
  }

  const accounts = (accountRows ?? []).map((row) => mapPortalAccountRow(row as Record<string, unknown>));
  if (!accounts.length) {
    return jsonResponse(
      {
        ok: false,
        error: organizationIdHint ? "portal_account_not_found_for_organization" : "portal_account_not_found",
      },
      { status: 403 }
    );
  }

  const account = accounts.find((entry) => entry.status === "active") ?? accounts[0];
  if (account.status !== "active") {
    return jsonResponse({ ok: false, error: "portal_account_not_active" }, { status: 403 });
  }

  return jsonResponse({
    ok: true,
    data: {
      portal_account: account,
      auth_user: {
        id: authUserId,
        email: asText(refreshData.user.email),
      },
      session: {
        access_token: refreshData.session.access_token,
        refresh_token: refreshData.session.refresh_token,
        token_type: refreshData.session.token_type,
        expires_in: refreshData.session.expires_in,
        expires_at: refreshData.session.expires_at,
      },
    },
    meta: {
      storage: "supabase.auth + crm.portal_accounts",
      source: "refresh_token",
    },
  });
};

export const GET: APIRoute = async () => methodNotAllowed(["POST"]);
export const PUT: APIRoute = async () => methodNotAllowed(["POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["POST"]);
