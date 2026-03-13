import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { mapCrmUser, setCrmAuthCookies } from "@shared/crm/auth";
import { getSupabaseServerAuthClient, getSupabaseServerClient } from "@shared/supabase/server";

type CrmRegisterBody = {
  full_name?: string;
  email?: string;
  password?: string;
};

const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const isAlreadyRegisteredError = (details: string | null): boolean => {
  const normalized = String(details ?? "").toLowerCase();
  return normalized.includes("already registered") || normalized.includes("already been registered");
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await parseJsonBody<CrmRegisterBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const fullName = asText(body.full_name);
  const email = asText(body.email)?.toLowerCase() ?? null;
  const password = asText(body.password);

  if (!fullName) return jsonResponse({ ok: false, error: "full_name_required" }, { status: 422 });
  if (!email) return jsonResponse({ ok: false, error: "email_required" }, { status: 422 });
  if (!password) return jsonResponse({ ok: false, error: "password_required" }, { status: 422 });
  if (password.length < 8) {
    return jsonResponse({ ok: false, error: "password_too_short", details: "Minimo 8 caracteres." }, { status: 422 });
  }

  const serviceClient = getSupabaseServerClient();
  const authClient = getSupabaseServerAuthClient();
  if (!serviceClient || !authClient) {
    return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });
  }

  const { data: createdUserData, error: createUserError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      crm_role: "staff",
    },
  });

  if (createUserError) {
    const details = asText(createUserError.message);
    return jsonResponse(
      {
        ok: false,
        error: isAlreadyRegisteredError(details) ? "email_already_registered" : "auth_create_user_failed",
        details,
      },
      { status: isAlreadyRegisteredError(details) ? 409 : 500 }
    );
  }

  if (!createdUserData.user) {
    return jsonResponse({ ok: false, error: "auth_create_user_failed" }, { status: 500 });
  }

  const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError || !signInData.session || !signInData.user) {
    return jsonResponse(
      {
        ok: false,
        error: "auto_login_failed",
        details: signInError?.message,
      },
      { status: 500 }
    );
  }

  setCrmAuthCookies(cookies, signInData.session);

  return jsonResponse(
    {
      ok: true,
      data: {
        user: mapCrmUser(signInData.user),
        session: {
          expires_at: signInData.session.expires_at ?? null,
          expires_in: signInData.session.expires_in ?? null,
        },
      },
      meta: {
        storage: "supabase.auth",
      },
    },
    { status: 201 }
  );
};

export const GET: APIRoute = async () => methodNotAllowed(["POST"]);
export const PUT: APIRoute = async () => methodNotAllowed(["POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["POST"]);
