import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed } from "@shared/api/json";
import { resolveCrmOrgAccess } from "@shared/crm/access";
import { buildDashboardHome } from "@shared/dashboard/home-crud";
import { asText, toPositiveInt } from "@shared/portal/domain";
import { getSupabaseServerClient } from "@shared/supabase/server";

export const GET: APIRoute = async ({ cookies, url }) => {
  const organizationIdHint = asText(url.searchParams.get("organization_id"));
  const scope = asText(url.searchParams.get("scope"));
  const window = asText(url.searchParams.get("window"));
  const inboxLimit = toPositiveInt(url.searchParams.get("inbox_limit"), 8, 1, 20);

  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint,
    allowedPermissions: ["crm.dashboard.view"],
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

  const client = getSupabaseServerClient();
  if (!client) {
    return jsonResponse(
      {
        ok: false,
        error: "dashboard_backend_unavailable",
        details: "Supabase o la capa operativa del cockpit no estan disponibles en este entorno.",
      },
      { status: 503 }
    );
  }

  try {
    const data = await buildDashboardHome(client, access.data, {
      scope,
      window,
      inboxLimit,
    });

    return jsonResponse({
      ok: true,
      data,
      meta: {
        persisted: true,
        storage: "supabase.crm.home_dashboard",
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "dashboard_home_read_failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
};

export const POST: APIRoute = async () => methodNotAllowed(["GET"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET"]);
