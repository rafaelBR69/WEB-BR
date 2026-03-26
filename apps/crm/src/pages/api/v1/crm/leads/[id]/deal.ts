import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { createOrReuseDeal, hydrateDealRows } from "@shared/deals/crud";
import { resolveCrmOrgAccess } from "@shared/crm/access";
import { asText, asUuid } from "@shared/portal/domain";
import { getSupabaseServerClient } from "@shared/supabase/server";

export const POST: APIRoute = async ({ cookies, params, request }) => {
  const leadId = asUuid(params.id);
  const body = (await parseJsonBody<Record<string, unknown>>(request)) ?? {};
  const organizationIdHint = asText(body.organization_id);

  if (!leadId) return jsonResponse({ ok: false, error: "invalid_lead_id" }, { status: 400 });

  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint,
    allowedPermissions: ["crm.deals.write"],
  });
  if (access.error || !access.data) {
    return jsonResponse(
      { ok: false, error: access.error?.error ?? "crm_auth_required", details: access.error?.details },
      { status: access.error?.status ?? 401 }
    );
  }

  const organizationId = access.data.organization_id;
  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  try {
    const result = await createOrReuseDeal(client, {
      organizationId,
      leadId,
      propertyId: asText(body.property_id),
      title: asText(body.title),
      expectedCloseDate: asText(body.expected_close_date),
      expectedValue: typeof body.expected_value === "number" ? body.expected_value : Number(body.expected_value ?? NaN),
      probability: typeof body.probability === "number" ? body.probability : Number(body.probability ?? NaN),
      ownerId: access.data.auth_user_id,
    });

    const hydrated = await hydrateDealRows(client, organizationId, [result.row]);
    return jsonResponse(
      { ok: true, data: hydrated[0] ?? null, meta: { created: result.created } },
      { status: result.created ? 201 : 200 }
    );
  } catch (error) {
    return jsonResponse(
      { ok: false, error: "lead_deal_create_failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
};

export const GET: APIRoute = async () => methodNotAllowed(["POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["POST"]);
