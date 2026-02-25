import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { getSupabaseServerAuthClient, getSupabaseServerClient } from "@/utils/supabaseServer";
import {
  PORTAL_ACCOUNT_SELECT_COLUMNS,
  asText,
  asUuid,
  getRequestIp,
  getRequestUserAgent,
  mapPortalAccountRow,
  safeInsertPortalAccessLog,
} from "@/utils/crmPortal";

type PortalLoginBody = {
  email?: string;
  password?: string;
};

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<PortalLoginBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const email = asText(body.email)?.toLowerCase() ?? null;
  const password = asText(body.password);

  if (!email) return jsonResponse({ ok: false, error: "email_required" }, { status: 422 });
  if (!password) return jsonResponse({ ok: false, error: "password_required" }, { status: 422 });

  const authClient = getSupabaseServerAuthClient();
  const serviceClient = getSupabaseServerClient();
  if (!authClient || !serviceClient) {
    return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });
  }

  const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({ email, password });
  if (signInError || !signInData.session || !signInData.user) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_credentials",
        details: signInError?.message,
      },
      { status: 401 }
    );
  }

  const authUserId = asUuid(signInData.user.id);
  if (!authUserId) {
    return jsonResponse({ ok: false, error: "invalid_auth_user_id" }, { status: 401 });
  }

  const { data: accountRows, error: accountError } = await serviceClient
    .schema("crm")
    .from("portal_accounts")
    .select(PORTAL_ACCOUNT_SELECT_COLUMNS)
    .eq("auth_user_id", authUserId)
    .order("created_at", { ascending: true });

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
    return jsonResponse({ ok: false, error: "portal_account_not_found" }, { status: 403 });
  }

  const account = accounts.find((entry) => entry.status === "active") ?? accounts[0];
  const organizationId = asUuid(account.organization_id);
  const portalAccountId = asUuid(account.id);

  if (!organizationId || !portalAccountId) {
    return jsonResponse({ ok: false, error: "portal_account_invalid_scope" }, { status: 500 });
  }

  if (account.status !== "active") {
    await safeInsertPortalAccessLog(serviceClient, {
      organization_id: organizationId,
      portal_account_id: portalAccountId,
      email,
      event_type: "login_fail",
      ip: getRequestIp(request),
      user_agent: getRequestUserAgent(request),
      metadata: {
        reason: "portal_account_not_active",
        status: account.status,
      },
    });

    return jsonResponse({ ok: false, error: "portal_account_not_active" }, { status: 403 });
  }

  const { data: updatedAccountRow } = await serviceClient
    .schema("crm")
    .from("portal_accounts")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", portalAccountId)
    .eq("organization_id", organizationId)
    .select(PORTAL_ACCOUNT_SELECT_COLUMNS)
    .maybeSingle();

  const finalAccount = updatedAccountRow
    ? mapPortalAccountRow(updatedAccountRow as Record<string, unknown>)
    : account;

  await safeInsertPortalAccessLog(serviceClient, {
    organization_id: organizationId,
    portal_account_id: portalAccountId,
    email,
    event_type: "login_ok",
    ip: getRequestIp(request),
    user_agent: getRequestUserAgent(request),
    metadata: {
      auth_user_id: authUserId,
      role: finalAccount.role,
    },
  });

  return jsonResponse({
    ok: true,
    data: {
      portal_account: finalAccount,
      auth_user: {
        id: authUserId,
        email: asText(signInData.user.email),
      },
      session: {
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
        token_type: signInData.session.token_type,
        expires_in: signInData.session.expires_in,
        expires_at: signInData.session.expires_at,
      },
    },
    meta: {
      storage: "supabase.auth + crm.portal_accounts",
    },
  });
};

export const GET: APIRoute = async () => methodNotAllowed(["POST"]);
export const PUT: APIRoute = async () => methodNotAllowed(["POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["POST"]);
