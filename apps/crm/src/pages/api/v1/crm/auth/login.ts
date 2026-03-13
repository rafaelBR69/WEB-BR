import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { mapCrmUser, setCrmAuthCookies } from "@shared/crm/auth";
import { getSupabaseServerAuthClient } from "@shared/supabase/server";

type CrmLoginBody = {
  email?: string;
  password?: string;
};

const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await parseJsonBody<CrmLoginBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const email = asText(body.email)?.toLowerCase() ?? null;
  const password = asText(body.password);

  if (!email) return jsonResponse({ ok: false, error: "email_required" }, { status: 422 });
  if (!password) return jsonResponse({ ok: false, error: "password_required" }, { status: 422 });

  const authClient = getSupabaseServerAuthClient();
  if (!authClient) return jsonResponse({ ok: false, error: "supabase_auth_not_configured" }, { status: 500 });

  const { data, error } = await authClient.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session || !data.user) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_credentials",
        details: error?.message,
      },
      { status: 401 }
    );
  }

  setCrmAuthCookies(cookies, data.session);

  return jsonResponse({
    ok: true,
    data: {
      user: mapCrmUser(data.user),
      session: {
        expires_at: data.session.expires_at ?? null,
        expires_in: data.session.expires_in ?? null,
      },
    },
    meta: {
      storage: "supabase.auth",
    },
  });
};

export const GET: APIRoute = async () => methodNotAllowed(["POST"]);
export const PUT: APIRoute = async () => methodNotAllowed(["POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["POST"]);
