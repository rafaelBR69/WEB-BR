import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed } from "@/utils/crmApi";
import { getSupabaseServerClient } from "@/utils/supabaseServer";
import { asText, asUuid } from "@/utils/crmPortal";
import { resolvePortalRequestContext } from "@/utils/portalAuth";

const getLeadId = (params: Record<string, string | undefined>): string | null => {
  const value = params.id;
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

export const GET: APIRoute = async ({ params, url, request }) => {
  const leadId = getLeadId(params);
  const organizationIdHint = asText(url.searchParams.get("organization_id"));

  if (!leadId) return jsonResponse({ ok: false, error: "lead_id_required" }, { status: 400 });

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

  let trackingQuery = client
    .schema("crm")
    .from("portal_lead_tracking")
    .select("*")
    .eq("lead_id", leadId)
    .eq("portal_account_id", portalAccountId)
    .maybeSingle();
  if (organizationId) trackingQuery = trackingQuery.eq("organization_id", organizationId);

  const { data: trackingRow, error: trackingError } = await trackingQuery;
  if (trackingError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_lead_tracking_read_error",
        details: trackingError.message,
      },
      { status: 500 }
    );
  }
  if (!trackingRow) return jsonResponse({ ok: false, error: "lead_access_denied" }, { status: 403 });

  let leadQuery = client.schema("crm").from("leads").select("*").eq("id", leadId).maybeSingle();
  if (organizationId) leadQuery = leadQuery.eq("organization_id", organizationId);
  const { data: leadRow, error: leadError } = await leadQuery;
  if (leadError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_lead_read_error",
        details: leadError.message,
      },
      { status: 500 }
    );
  }
  if (!leadRow) return jsonResponse({ ok: false, error: "lead_not_found" }, { status: 404 });

  const contactId = asUuid((leadRow as Record<string, unknown>).contact_id);
  let contactRow: Record<string, unknown> | null = null;
  if (contactId) {
    let contactQuery = client
      .schema("crm")
      .from("contacts")
      .select("id, full_name, email, phone, preferred_language")
      .eq("id", contactId)
      .maybeSingle();
    if (organizationId) contactQuery = contactQuery.eq("organization_id", organizationId);
    const { data: contactData } = await contactQuery;
    contactRow = (contactData as Record<string, unknown> | null) ?? null;
  }

  let visitsQuery = client
    .schema("crm")
    .from("portal_visit_requests")
    .select("*")
    .eq("lead_id", leadId)
    .eq("portal_account_id", portalAccountId)
    .order("created_at", { ascending: false });
  if (organizationId) visitsQuery = visitsQuery.eq("organization_id", organizationId);
  const { data: visitsRows, error: visitsError } = await visitsQuery;
  if (visitsError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_visit_requests_read_error",
        details: visitsError.message,
      },
      { status: 500 }
    );
  }

  let commissionsQuery = client
    .schema("crm")
    .from("portal_commission_status")
    .select("*")
    .eq("lead_id", leadId)
    .eq("portal_account_id", portalAccountId)
    .order("updated_at", { ascending: false });
  if (organizationId) commissionsQuery = commissionsQuery.eq("organization_id", organizationId);
  const { data: commissionsRows, error: commissionsError } = await commissionsQuery;
  if (commissionsError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_commissions_read_error",
        details: commissionsError.message,
      },
      { status: 500 }
    );
  }

  return jsonResponse({
    ok: true,
    data: {
      lead: leadRow,
      contact: contactRow,
      tracking: trackingRow,
      visits: (visitsRows ?? []) as Array<Record<string, unknown>>,
      commissions: (commissionsRows ?? []) as Array<Record<string, unknown>>,
    },
    meta: {
      storage: "supabase.crm.portal_lead_tracking + crm.leads + crm.portal_visit_requests + crm.portal_commission_status",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET"]);
