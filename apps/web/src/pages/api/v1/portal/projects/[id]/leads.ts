import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed } from "@shared/api/json";
import { asText } from "@shared/portal/domain";
import { resolvePortalRequestContext } from "@shared/portal/auth";

export const POST: APIRoute = async ({ request, url }) => {
  const organizationIdHint = asText(url.searchParams.get("organization_id"));

  const auth = await resolvePortalRequestContext(request, { organizationIdHint });
  if (auth.error || !auth.data) {
    return jsonResponse(
      {
        ok: false,
        error: auth.error?.error ?? "auth_context_unresolved",
        details: auth.error?.details,
      },
      { status: auth.error?.status ?? 401 }
    );
  }

  return jsonResponse(
    {
      ok: false,
      error: "portal_lead_submission_disabled",
      message: "Lead submission from portal is disabled. Operate lead creation from CRM only.",
    },
    { status: 410 }
  );
};

export const GET: APIRoute = async () => methodNotAllowed(["POST"]);
export const PUT: APIRoute = async () => methodNotAllowed(["POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["POST"]);
