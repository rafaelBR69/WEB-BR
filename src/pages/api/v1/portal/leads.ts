import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed } from "@/utils/crmApi";
import { getSupabaseServerClient } from "@/utils/supabaseServer";
import { asText, asUuid, toPositiveInt } from "@/utils/crmPortal";
import { resolvePortalRequestContext } from "@/utils/portalAuth";

const TRACKING_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "lead_id",
  "project_property_id",
  "portal_account_id",
  "attribution_status",
  "duplicate_of_lead_id",
  "dispute_until",
  "evidence",
  "timeline",
  "created_at",
  "updated_at",
].join(", ");

export const GET: APIRoute = async ({ url, request }) => {
  const organizationIdHint = asText(url.searchParams.get("organization_id"));
  const projectId = asUuid(url.searchParams.get("project_property_id"));
  const attributionStatus = asText(url.searchParams.get("attribution_status"));
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

  let trackingQuery = client
    .schema("crm")
    .from("portal_lead_tracking")
    .select(TRACKING_SELECT_COLUMNS, { count: "exact" })
    .eq("portal_account_id", portalAccountId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (organizationId) trackingQuery = trackingQuery.eq("organization_id", organizationId);
  if (projectId) trackingQuery = trackingQuery.eq("project_property_id", projectId);
  if (attributionStatus) trackingQuery = trackingQuery.eq("attribution_status", attributionStatus);

  const { data: trackingRows, error: trackingError, count } = await trackingQuery;
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

  const tracking = (trackingRows ?? []) as Array<Record<string, unknown>>;
  const leadIds = Array.from(
    new Set(
      tracking
        .map((entry) => asUuid(entry.lead_id))
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );

  let leadsById = new Map<string, Record<string, unknown>>();
  let contactsById = new Map<string, Record<string, unknown>>();

  if (leadIds.length) {
    let leadsQuery = client.schema("crm").from("leads").select("*").in("id", leadIds);
    if (organizationId) leadsQuery = leadsQuery.eq("organization_id", organizationId);

    const { data: leadsRows, error: leadsError } = await leadsQuery;
    if (leadsError) {
      return jsonResponse(
        {
          ok: false,
          error: "db_leads_read_error",
          details: leadsError.message,
        },
        { status: 500 }
      );
    }

    (leadsRows ?? []).forEach((row) => {
      const id = asUuid((row as Record<string, unknown>).id);
      if (!id) return;
      leadsById.set(id, row as Record<string, unknown>);
    });

    const contactIds = Array.from(
      new Set(
        (leadsRows ?? [])
          .map((row) => asUuid((row as Record<string, unknown>).contact_id))
          .filter((value): value is string => Boolean(value))
      )
    );

    if (contactIds.length) {
      let contactsQuery = client.schema("crm").from("contacts").select("id, full_name, email, phone").in("id", contactIds);
      if (organizationId) contactsQuery = contactsQuery.eq("organization_id", organizationId);
      const { data: contactsRows } = await contactsQuery;
      (contactsRows ?? []).forEach((row) => {
        const id = asUuid((row as Record<string, unknown>).id);
        if (!id) return;
        contactsById.set(id, row as Record<string, unknown>);
      });
    }
  }

  const data = tracking.map((entry) => {
    const leadId = asUuid(entry.lead_id);
    const lead = leadId ? leadsById.get(leadId) ?? null : null;
    const contactId = lead ? asUuid((lead as Record<string, unknown>).contact_id) : null;
    const contact = contactId ? contactsById.get(contactId) ?? null : null;
    return {
      tracking: entry,
      lead,
      contact,
    };
  });

  const total = typeof count === "number" ? count : data.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return jsonResponse({
    ok: true,
    data,
    meta: {
      count: data.length,
      total,
      page,
      per_page: perPage,
      total_pages: totalPages,
      storage: "supabase.crm.portal_lead_tracking + crm.leads",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET"]);
