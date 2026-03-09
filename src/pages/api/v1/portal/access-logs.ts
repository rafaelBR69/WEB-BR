import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";
import { asText, asUuid, toPositiveInt } from "@/utils/crmPortal";
import { resolvePortalRequestContext } from "@/utils/portalAuth";

const DEFAULT_LOGS_ADMIN_EMAILS = ["rafael@blancareal.com"];

const parseLogsAdminEmails = (): Set<string> => {
  const raw = asText(import.meta.env.CRM_PORTAL_LOGS_ADMIN_EMAILS);
  const configured = raw
    ? raw
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0)
    : [];

  return new Set([...DEFAULT_LOGS_ADMIN_EMAILS, ...configured]);
};

const LOGS_ADMIN_EMAILS = parseLogsAdminEmails();

export const GET: APIRoute = async ({ url, request }) => {
  const organizationIdHint = asText(url.searchParams.get("organization_id"));
  const leadId = asUuid(url.searchParams.get("lead_id"));
  const projectId = asUuid(url.searchParams.get("project_property_id"));
  const eventType = asText(url.searchParams.get("event_type"));
  const email = asText(url.searchParams.get("email"))?.toLowerCase() ?? null;
  const fromDate = asText(url.searchParams.get("from"));
  const toDate = asText(url.searchParams.get("to"));
  const page = toPositiveInt(url.searchParams.get("page"), 1, 1, 10000);
  const perPage = toPositiveInt(url.searchParams.get("per_page"), 50, 1, 200);

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

  if (auth.data.portal_account.role !== "portal_agent_admin") {
    return jsonResponse({ ok: false, error: "portal_logs_admin_only" }, { status: 403 });
  }

  const viewerEmail = asText(auth.data.auth_email)?.toLowerCase() ?? null;
  if (!viewerEmail || !LOGS_ADMIN_EMAILS.has(viewerEmail)) {
    return jsonResponse({ ok: false, error: "portal_logs_email_not_allowed" }, { status: 403 });
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
        viewer_email: viewerEmail,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const organizationId = auth.data.organization_id;
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let query = client
    .schema("crm")
    .from("portal_access_logs")
    .select("*", { count: "exact" })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .range(from, to);

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
      viewer_email: viewerEmail,
      access_scope: "portal_admin_email_whitelist",
      storage: "supabase.crm.portal_access_logs",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET"]);
