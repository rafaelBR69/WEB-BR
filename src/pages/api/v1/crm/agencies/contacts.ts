import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { resolveCrmOrgAccess } from "@/utils/crmAccess";
import { getSupabaseServerClient } from "@/utils/supabaseServer";
import { asText, asUuid, toPositiveInt } from "@/utils/crmPortal";
import { buildAgencyAnalyticsContext, buildAgencyContactMetrics } from "@/utils/crmAgencyAnalytics";
import { createAgencyContactBundle, type AgencyContactCreateInput } from "@/utils/crmAgencyCrud";

export const GET: APIRoute = async ({ url, cookies }) => {
  const organizationIdHint = asText(url.searchParams.get("organization_id"));
  const q = asText(url.searchParams.get("q"))?.toLowerCase() ?? "";
  const agencyIdFilter = asUuid(url.searchParams.get("agency_id"));
  const page = toPositiveInt(url.searchParams.get("page"), 1, 1, 10000);
  const perPage = toPositiveInt(url.searchParams.get("per_page"), 25, 1, 200);

  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint,
    allowedPermissions: ["crm.clients.read"],
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

  const organizationId = access.data.organization_id;
  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  try {
    const context = await buildAgencyAnalyticsContext(client, organizationId);
    const rows = buildAgencyContactMetrics(context)
      .filter((row) => row.relation_status === "active")
      .map((row) => ({
        ...row,
        search_blob: [
          row.full_name,
          row.email,
          row.phone,
          row.role,
          row.agency_name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      }));

    const filteredRows = rows
      .filter((row) => {
        if (agencyIdFilter && row.agency_id !== agencyIdFilter) return false;
        if (q && !String(row.search_blob ?? "").includes(q)) return false;
        return true;
      })
      .sort(
        (a, b) =>
          b.attributed_customer_total - a.attributed_customer_total ||
          b.attributed_records_total - a.attributed_records_total ||
          b.converted_clients_total - a.converted_clients_total ||
          Number(b.is_primary) - Number(a.is_primary) ||
          String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""), "es")
      );

    const total = filteredRows.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const safePage = Math.min(page, totalPages);
    const from = (safePage - 1) * perPage;
    const pageRows = filteredRows.slice(from, from + perPage).map((row) => {
      const { search_blob, ...rest } = row;
      return rest;
    });

    return jsonResponse({
      ok: true,
      data: pageRows,
      meta: {
        count: pageRows.length,
        total,
        page: safePage,
        per_page: perPage,
        total_pages: totalPages,
        organization_id: organizationId,
        summary: {
          active_contacts_total: filteredRows.length,
          contacts_with_leads_total: filteredRows.filter((row) => row.attributed_records_total > 0 || row.leads_total > 0).length,
          attributed_records_total: filteredRows.reduce((sum, row) => sum + row.attributed_records_total, 0),
          attributed_customer_total: filteredRows.reduce((sum, row) => sum + row.attributed_customer_total, 0),
          leads_total: filteredRows.reduce((sum, row) => sum + row.leads_total, 0),
          converted_clients_total: filteredRows.reduce((sum, row) => sum + row.converted_clients_total, 0),
          reserved_clients_total: filteredRows.reduce((sum, row) => sum + row.reserved_clients_total, 0),
        },
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "crm_agency_contacts_unhandled_error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await parseJsonBody<AgencyContactCreateInput & { organization_id?: string | null }>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const agencyId = asUuid(body.agency_id);
  const fullName = asText(body.full_name);
  if (!agencyId) return jsonResponse({ ok: false, error: "invalid_agency_id" }, { status: 422 });
  if (!fullName) return jsonResponse({ ok: false, error: "contact_name_required" }, { status: 422 });

  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint: asText(body.organization_id),
    allowedPermissions: ["crm.clients.write"],
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

  const organizationId = access.data.organization_id;
  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  try {
    const created = await createAgencyContactBundle(client, organizationId, {
      agency_id: agencyId,
      full_name: fullName,
      email: asText(body.email),
      phone: asText(body.phone),
      role: asText(body.role),
      is_primary: body.is_primary === true,
      notes: asText(body.notes),
    });
    if (!created) return jsonResponse({ ok: false, error: "agency_not_found" }, { status: 404 });

    return jsonResponse(
      {
        ok: true,
        data: {
          agency_contact_id: asUuid(created.agency_contact.id),
          contact_id: asUuid(created.contact.id),
          agency_id: asUuid(created.agency.id),
          full_name: asText(created.contact.full_name),
          role: asText(created.agency_contact.role),
          relation_status: asText(created.agency_contact.relation_status),
        },
        meta: {
          organization_id: organizationId,
          storage: "supabase.crm.contacts + crm.agency_contacts",
        },
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const meta = error instanceof Error && "meta" in error ? (error as Error & { meta?: Record<string, unknown> }).meta : undefined;
    const isDuplicate =
      message === "agency_contact_duplicate_in_agency" || message === "agency_contact_identity_in_other_agency";
    return jsonResponse(
      {
        ok: false,
        error: isDuplicate ? message : "crm_agency_contact_create_unhandled_error",
        details: message,
        ...(meta ? { meta } : {}),
      },
      { status: isDuplicate ? 409 : 500 }
    );
  }
};
export const PATCH: APIRoute = async () => methodNotAllowed(["GET"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET"]);
