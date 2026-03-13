import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { resolveCrmOrgAccess } from "@shared/crm/access";
import { getSupabaseServerClient } from "@shared/supabase/server";
import { asText, asUuid } from "@shared/portal/domain";
import { buildAgencyAnalyticsContext, buildAgencyContactMetrics } from "@shared/agencies/analytics";
import { getPropertyDisplayNameFromRow } from "@shared/properties/domain";
import {
  deactivateAgencyContactBundle,
  type AgencyContactUpdateInput,
  updateAgencyContactBundle,
} from "@shared/agencies/crud";

const asObjectRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const firstText = (...values: unknown[]) => {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return null;
};

export const GET: APIRoute = async ({ params, url, cookies }) => {
  const agencyContactId = asUuid(params.id);
  const organizationIdHint = asText(url.searchParams.get("organization_id"));

  if (!agencyContactId) return jsonResponse({ ok: false, error: "invalid_agency_contact_id" }, { status: 400 });

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
    const agencyContact =
      buildAgencyContactMetrics(context).find(
        (row) => row.agency_contact_id === agencyContactId || row.alias_agency_contact_ids?.includes(agencyContactId)
      ) ?? null;
    if (!agencyContact) return jsonResponse({ ok: false, error: "agency_contact_not_found" }, { status: 404 });

    const convertedClients = agencyContact.converted_client_ids
      .map((clientId) => {
        const clientRow = context.clientById.get(clientId) ?? null;
        if (!clientRow) return null;
        return {
          client_id: clientId,
          billing_name: asText(clientRow.billing_name),
          client_code: asText(clientRow.client_code),
          reservation_count: context.reservationsByClientId.get(clientId)?.length ?? 0,
        };
      })
      .filter((value): value is { client_id: string; billing_name: string | null; client_code: string | null; reservation_count: number } => Boolean(value))
      .sort(
        (a, b) =>
          b.reservation_count - a.reservation_count ||
          String(a.billing_name ?? "").localeCompare(String(b.billing_name ?? ""), "es")
      );
    const attributedCustomers = agencyContact.attributed_customer_name_samples.map((fullName, index) => ({
      id: `attributed_${index + 1}`,
      full_name: fullName,
    }));
    const crmLeads = agencyContact.matched_lead_ids
      .map((leadId) => {
        const leadRow = context.leads.find((row) => asUuid(row.id) === leadId) ?? null;
        if (!leadRow) return null;
        const leadContact = context.contactById.get(asUuid(leadRow.contact_id) ?? "") ?? null;
        const propertyRow = context.propertyById.get(asUuid(leadRow.property_id) ?? "") ?? null;
        const rawPayload = asObjectRecord(leadRow.raw_payload);
        const mapped = asObjectRecord(rawPayload.mapped);
        const convertedClientId = asUuid(leadRow.converted_client_id);
        const convertedClient = convertedClientId ? context.clientById.get(convertedClientId) ?? null : null;
        return {
          lead_id: leadId,
          full_name: firstText(leadContact?.full_name, mapped.full_name, "Lead sin nombre"),
          email: asText(leadContact?.email) ?? asText(mapped.email),
          phone: asText(leadContact?.phone) ?? asText(mapped.phone),
          status: asText(leadRow.status),
          lead_kind: asText(leadRow.lead_kind),
          origin_type: asText(leadRow.origin_type),
          source: asText(leadRow.source),
          created_at: asText(leadRow.created_at),
          converted_client_id: convertedClientId,
          converted_client_name: asText(convertedClient?.billing_name),
          project_id: asUuid(leadRow.property_id),
          project_label:
            getPropertyDisplayNameFromRow(propertyRow ?? {}) ??
            asText(propertyRow?.legacy_code) ??
            "Proyecto",
        };
      })
      .filter(
        (
          value
        ): value is {
          lead_id: string;
          full_name: string | null;
          email: string | null;
          phone: string | null;
          status: string | null;
          lead_kind: string | null;
          origin_type: string | null;
          source: string | null;
          created_at: string | null;
          converted_client_id: string | null;
          converted_client_name: string | null;
          project_id: string | null;
          project_label: string;
        } => Boolean(value)
      )
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
    const attributedLeadSamples = agencyContact.attributed_lead_name_samples
      .filter((fullName) => fullName && !crmLeads.some((lead) => lead.full_name === fullName))
      .slice(0, 12)
      .map((full_name, index) => ({
        id: `historical_lead_${index + 1}`,
        full_name,
      }));

    return jsonResponse({
      ok: true,
      data: {
        contact: agencyContact,
        kpis: {
          attributed_records_total: agencyContact.attributed_records_total,
          attributed_records_with_identity_total: agencyContact.attributed_records_with_identity_total,
          attributed_customer_total: agencyContact.attributed_customer_total,
          attributed_discarded_total: agencyContact.attributed_discarded_total,
          attributed_active_total: agencyContact.attributed_active_total,
          leads_total: agencyContact.leads_total,
          leads_open_total: agencyContact.leads_open_total,
          leads_converted_total: agencyContact.leads_converted_total,
          converted_clients_total: agencyContact.converted_clients_total,
          reserved_clients_total: agencyContact.reserved_clients_total,
          projects_total: agencyContact.projects_total,
          lead_conversion_rate_pct: agencyContact.lead_conversion_rate_pct,
          attributed_customer_rate_pct: agencyContact.attributed_customer_rate_pct,
        },
        charts: {
          attributed_monthly_records: agencyContact.attributed_monthly_records,
          attributed_status_breakdown: agencyContact.attributed_status_breakdown,
          attributed_project_mix: agencyContact.attributed_project_mix,
          monthly_leads: agencyContact.monthly_leads,
          status_breakdown: agencyContact.status_breakdown,
          project_mix: agencyContact.project_mix,
        },
        crm_leads: crmLeads,
        attributed_lead_samples: attributedLeadSamples,
        converted_clients: convertedClients,
        attributed_customers: attributedCustomers,
      },
      meta: {
        organization_id: organizationId,
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "crm_agency_contact_detail_unhandled_error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
};

export const POST: APIRoute = async () => methodNotAllowed(["GET", "PATCH", "DELETE"]);

export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  const agencyContactId = asUuid(params.id);
  if (!agencyContactId) return jsonResponse({ ok: false, error: "invalid_agency_contact_id" }, { status: 400 });

  const body = await parseJsonBody<AgencyContactUpdateInput & { organization_id?: string | null }>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

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
    const updated = await updateAgencyContactBundle(client, organizationId, agencyContactId, body);
    if (!updated) return jsonResponse({ ok: false, error: "agency_contact_not_found" }, { status: 404 });

    return jsonResponse({
      ok: true,
      data: {
        agency_contact_id: agencyContactId,
        contact_id: asUuid(updated.contact?.id),
        agency_id: asUuid(updated.agency?.id),
        full_name: asText(updated.contact?.full_name),
        relation_status: asText(updated.agency_contact.relation_status),
        is_primary: updated.agency_contact.is_primary === true,
      },
      meta: {
        organization_id: organizationId,
        storage: "supabase.crm.contacts + crm.agency_contacts",
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "crm_agency_contact_update_unhandled_error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
};

export const DELETE: APIRoute = async ({ params, url, cookies }) => {
  const agencyContactId = asUuid(params.id);
  if (!agencyContactId) return jsonResponse({ ok: false, error: "invalid_agency_contact_id" }, { status: 400 });

  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint: asText(url.searchParams.get("organization_id")),
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
    const updated = await deactivateAgencyContactBundle(client, organizationId, agencyContactId);
    if (!updated) return jsonResponse({ ok: false, error: "agency_contact_not_found" }, { status: 404 });

    return jsonResponse({
      ok: true,
      data: {
        agency_contact_id: agencyContactId,
        deactivated: true,
        relation_status: asText(updated.agency_contact.relation_status),
        agency_id: asUuid(updated.agency?.id),
      },
      meta: {
        organization_id: organizationId,
        mode: "deactivate",
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "crm_agency_contact_deactivate_unhandled_error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
};
