import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";
import { asText, asUuid, toPositiveInt } from "@/utils/crmPortal";

export const GET: APIRoute = async ({ url }) => {
  const organizationId = asText(url.searchParams.get("organization_id"));
  const portalAccountId = asUuid(url.searchParams.get("portal_account_id"));
  const leadId = asUuid(url.searchParams.get("lead_id"));
  const projectId = asUuid(url.searchParams.get("project_property_id"));
  const eventType = asText(url.searchParams.get("event_type"));
  const email = asText(url.searchParams.get("email"))?.toLowerCase() ?? null;
  const fromDate = asText(url.searchParams.get("from"));
  const toDate = asText(url.searchParams.get("to"));
  const page = toPositiveInt(url.searchParams.get("page"), 1, 1, 10000);
  const perPage = toPositiveInt(url.searchParams.get("per_page"), 50, 1, 200);

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
    .from("portal_access_logs")
    .select("*", { count: "exact" })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (portalAccountId) query = query.eq("portal_account_id", portalAccountId);
  if (leadId) query = query.eq("lead_id", leadId);
  if (projectId) query = query.eq("project_property_id", projectId);
  if (eventType) query = query.eq("event_type", eventType);
  if (email) query = query.ilike("email", email);
  if (fromDate) query = query.gte("created_at", fromDate);
  if (toDate) query = query.lte("created_at", toDate);

  const { data, error, count } = await query;
  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_access_logs_read_error",
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
      storage: "supabase.crm.portal_access_logs",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET"]);
