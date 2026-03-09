import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed } from "@/utils/crmApi";
import { mapCrmUser, resolveCrmAuthFromCookies } from "@/utils/crmAuth";

export const GET: APIRoute = async ({ cookies }) => {
  const auth = await resolveCrmAuthFromCookies(cookies);
  if (!auth.ok || !auth.user) {
    return jsonResponse(
      {
        ok: false,
        error: auth.error ?? "crm_auth_required",
      },
      { status: 401 }
    );
  }

  return jsonResponse({
    ok: true,
    data: {
      user: mapCrmUser(auth.user),
      session: {
        refreshed: auth.refreshed,
      },
    },
    meta: {
      storage: "supabase.auth.cookies",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET"]);
