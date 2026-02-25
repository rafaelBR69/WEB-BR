import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed } from "@/utils/crmApi";
import { getSupabaseServerClient } from "@/utils/supabaseServer";
import { asText, asUuid, toPositiveInt } from "@/utils/crmPortal";
import { resolvePortalRequestContext } from "@/utils/portalAuth";

export const GET: APIRoute = async ({ url, request }) => {
  const organizationIdHint = asText(url.searchParams.get("organization_id"));
  const projectId = asUuid(url.searchParams.get("project_property_id"));
  const leadId = asUuid(url.searchParams.get("lead_id"));
  const dealId = asUuid(url.searchParams.get("deal_id"));
  const status = asText(url.searchParams.get("status"));
  const page = toPositiveInt(url.searchParams.get("page"), 1, 1, 10000);
  const perPage = toPositiveInt(url.searchParams.get("per_page"), 25, 1, 200);

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

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

  const portalAccountId = auth.data.portal_account.id;
  const organizationId = auth.data.organization_id;
  if (!portalAccountId) return jsonResponse({ ok: false, error: "portal_account_id_missing" }, { status: 500 });

  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let query = client
    .schema("crm")
    .from("portal_commission_status")
    .select("*", { count: "exact" })
    .eq("portal_account_id", portalAccountId)
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (organizationId) query = query.eq("organization_id", organizationId);
  if (projectId) query = query.eq("project_property_id", projectId);
  if (leadId) query = query.eq("lead_id", leadId);
  if (dealId) query = query.eq("deal_id", dealId);
  if (status) query = query.eq("status", status);

  const { data, error, count } = await query;
  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_commissions_read_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
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
      storage: "supabase.crm.portal_commission_status",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET"]);
