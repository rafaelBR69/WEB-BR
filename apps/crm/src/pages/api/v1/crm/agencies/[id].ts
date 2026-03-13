import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { resolveCrmOrgAccess } from "@shared/crm/access";
import { getSupabaseServerClient } from "@shared/supabase/server";
import { asText, asUuid } from "@shared/portal/domain";
import { buildAgencyAnalyticsContext, buildAgencyContactMetrics, buildAgencyMetrics, monthKeyFromValue, monthLabelFromKey } from "@shared/agencies/analytics";
import { getPropertyDisplayNameFromRow } from "@shared/properties/domain";
import { archiveAgencyBundle, readAgencyBundle, type AgencyUpdateInput, updateAgencyBundle } from "@shared/agencies/crud";

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

const pickLeadAgencyName = (lead: Record<string, unknown>) => {
  const rawPayload = asObjectRecord(lead.raw_payload);
  const mapped = asObjectRecord(rawPayload.mapped);
  return firstText(
    mapped.agency_name,
    mapped.agency,
    rawPayload.agency_name,
    rawPayload.agency,
    rawPayload["NOMBRE AGENCIA"],
    rawPayload["AGENCIA"]
  );
};

const pickLeadAgentName = (lead: Record<string, unknown>) => {
  const rawPayload = asObjectRecord(lead.raw_payload);
  const mapped = asObjectRecord(rawPayload.mapped);
  return firstText(
    mapped.agency_contact_name,
    mapped.agent_name,
    rawPayload.agency_contact_name,
    rawPayload.agent_name,
    rawPayload["AGENTE AGENCIA"],
    rawPayload["Agente agencia"]
  );
};

export const GET: APIRoute = async ({ params, url, cookies }) => {
  const agencyId = asUuid(params.id);
  const organizationIdHint = asText(url.searchParams.get("organization_id"));

  if (!agencyId) return jsonResponse({ ok: false, error: "invalid_agency_id" }, { status: 400 });

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
    const agencyRow = context.agencyById.get(agencyId) ?? null;
    if (!agencyRow) return jsonResponse({ ok: false, error: "agency_not_found" }, { status: 404 });

    const agencyMetric = buildAgencyMetrics(context).find((row) => row.agency_id === agencyId) ?? null;
    const attributedAgency = context.attributedByAgencyId.get(agencyId) ?? null;
    const agencyContactRows = buildAgencyContactMetrics(context)
      .filter((row) => row.agency_id === agencyId && row.relation_status === "active")
      .sort(
        (a, b) =>
          b.converted_clients_total - a.converted_clients_total ||
          b.leads_total - a.leads_total ||
          Number(b.is_primary) - Number(a.is_primary) ||
          String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""), "es")
      );

    const baseClient = context.clientById.get(asUuid(agencyRow.client_id) ?? "") ?? null;
    const baseProfile =
      baseClient?.profile_data && typeof baseClient.profile_data === "object"
        ? (baseClient.profile_data as Record<string, unknown>)
        : {};
    const baseContact = context.contactById.get(asUuid(baseClient?.contact_id) ?? "") ?? null;
    const agencyLeadRows = context.leads.filter((row) => asUuid(row.agency_id) === agencyId);
    const linkedClients = context.linkedClientsByAgencyId.get(agencyId) ?? [];
    const linkedReservations = context.reservations.filter((row) =>
      linkedClients.some((clientRow) => asUuid(clientRow.id) === asUuid(row.client_id))
    );
    const leadContactByLeadId = new Map<string, (typeof agencyContactRows)[number]>();
    agencyContactRows.forEach((row) => {
      row.matched_lead_ids.forEach((leadId) => {
        if (!leadContactByLeadId.has(leadId)) leadContactByLeadId.set(leadId, row);
      });
    });

    const monthlyMap = new Map<string, { key: string; total: number; converted: number; converted_clients: Set<string> }>();
    const statusMap = new Map<string, number>();
    const projectMap = new Map<string, { project_id: string; leads_total: number; converted_clients_total: number; linked_clients_total: number }>();

    agencyLeadRows.forEach((lead) => {
      const status = asText(lead.status) ?? "new";
      const monthKey = monthKeyFromValue(lead.created_at);
      if (monthKey) {
        const current = monthlyMap.get(monthKey) ?? { key: monthKey, total: 0, converted: 0, converted_clients: new Set<string>() };
        current.total += 1;
        if (status === "converted" || status === "won" || asText(lead.converted_at) || asUuid(lead.converted_client_id)) {
          current.converted += 1;
        }
        const convertedClientId = asUuid(lead.converted_client_id);
        if (convertedClientId) current.converted_clients.add(convertedClientId);
        monthlyMap.set(monthKey, current);
      }

      statusMap.set(status, (statusMap.get(status) ?? 0) + 1);
      const projectId = asUuid(lead.property_id);
      if (!projectId) return;
      const current = projectMap.get(projectId) ?? {
        project_id: projectId,
        leads_total: 0,
        converted_clients_total: 0,
        linked_clients_total: 0,
      };
      current.leads_total += 1;
      if (asUuid(lead.converted_client_id)) current.converted_clients_total += 1;
      projectMap.set(projectId, current);
    });

    linkedReservations.forEach((reservation) => {
      const projectId = asUuid(reservation.project_property_id);
      if (!projectId) return;
      const current = projectMap.get(projectId) ?? {
        project_id: projectId,
        leads_total: 0,
        converted_clients_total: 0,
        linked_clients_total: 0,
      };
      current.linked_clients_total += 1;
      projectMap.set(projectId, current);
    });

    const convertedClientIds = new Set(
      agencyLeadRows.map((row) => asUuid(row.converted_client_id)).filter((value): value is string => Boolean(value))
    );
    const attributedProjectMix = attributedAgency?.project_mix ?? [];
    const attributedMonthly = attributedAgency?.monthly_records ?? [];
    const attributedStatusBreakdown = attributedAgency?.status_breakdown ?? [];
    const crmLeads = agencyLeadRows
      .map((lead) => {
        const leadId = asUuid(lead.id);
        if (!leadId) return null;
        const leadContact = context.contactById.get(asUuid(lead.contact_id) ?? "") ?? null;
        const propertyRow = context.propertyById.get(asUuid(lead.property_id) ?? "") ?? null;
        const agencyContact = leadContactByLeadId.get(leadId) ?? null;
        const rawPayload = asObjectRecord(lead.raw_payload);
        const mapped = asObjectRecord(rawPayload.mapped);
        const convertedClientId = asUuid(lead.converted_client_id);
        const convertedClient = convertedClientId ? context.clientById.get(convertedClientId) ?? null : null;
        return {
          lead_id: leadId,
          full_name: firstText(leadContact?.full_name, mapped.full_name, "Lead sin nombre"),
          email: firstText(leadContact?.email, mapped.email),
          phone: firstText(leadContact?.phone, mapped.phone),
          status: asText(lead.status),
          lead_kind: asText(lead.lead_kind),
          origin_type: asText(lead.origin_type),
          source: asText(lead.source),
          created_at: asText(lead.created_at),
          updated_at: asText(lead.updated_at),
          converted_client_id: convertedClientId,
          converted_client_name: asText(convertedClient?.billing_name),
          project_id: asUuid(lead.property_id),
          project_label:
            getPropertyDisplayNameFromRow(propertyRow ?? {}) ??
            asText(propertyRow?.legacy_code) ??
            "Proyecto",
          agency_contact_id: agencyContact?.agency_contact_id ?? null,
          agency_contact_name: firstText(agencyContact?.full_name, pickLeadAgentName(lead)),
          raw_agency_name: pickLeadAgencyName(lead),
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
          updated_at: string | null;
          converted_client_id: string | null;
          converted_client_name: string | null;
          project_id: string | null;
          project_label: string;
          agency_contact_id: string | null;
          agency_contact_name: string | null;
          raw_agency_name: string | null;
        } => Boolean(value)
      )
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
    const clientsBrought = linkedClients
      .map((row) => {
        const profileData =
          row.profile_data && typeof row.profile_data === "object"
            ? (row.profile_data as Record<string, unknown>)
            : {};
        const clientId = asUuid(row.id);
        return {
          client_id: clientId,
          billing_name: asText(row.billing_name),
          client_code: asText(row.client_code),
          client_status: asText(row.client_status),
          linked_agency_match_status: asText(profileData.linked_agency_match_status),
          linked_agency_match_score: Number(profileData.linked_agency_match_score ?? 0) || 0,
          reservation_count: clientId ? (context.reservationsByClientId.get(clientId)?.length ?? 0) : 0,
          is_from_converted_lead: clientId ? convertedClientIds.has(clientId) : false,
        };
      })
      .sort(
        (a, b) =>
          Number(b.is_from_converted_lead) - Number(a.is_from_converted_lead) ||
          b.reservation_count - a.reservation_count ||
          String(a.billing_name ?? "").localeCompare(String(b.billing_name ?? ""), "es")
      );
    const attributedLeadSamples = (attributedAgency?.sample_lead_names ?? [])
      .filter((fullName) => fullName && !crmLeads.some((lead) => lead.full_name === fullName))
      .slice(0, 12)
      .map((full_name, index) => ({
        id: `historical_lead_${index + 1}`,
        full_name,
      }));

    const detail = {
      agency_id: agencyId,
      agency_code: asText(agencyRow.agency_code),
      full_name:
        asText(baseClient?.billing_name) ??
        asText(baseProfile.agency_name) ??
        asText(baseProfile.agent_name) ??
        asText(baseContact?.full_name) ??
        asText(agencyRow.agency_code) ??
        "Agencia",
      email: asText(baseContact?.email),
      phone: asText(baseContact?.phone),
      agent_name: asText(baseProfile.agent_name) ?? asText(baseContact?.full_name),
      client_id: asUuid(baseClient?.id),
      client_code: asText(baseClient?.client_code),
      client_status: asText(baseClient?.client_status),
      agency_status: asText(agencyRow.agency_status),
      agency_scope: asText(agencyRow.agency_scope),
      agency_is_referral_source: agencyRow.is_referral_source !== false,
      agency_notes: asText(agencyRow.notes),
      created_at: asText(agencyRow.created_at),
      updated_at: asText(agencyRow.updated_at),
    };

    return jsonResponse({
      ok: true,
      data: {
        agency: detail,
        kpis: {
          attributed_records_total: agencyMetric?.attributed_records_total ?? 0,
          attributed_records_with_identity_total: agencyMetric?.attributed_records_with_identity_total ?? 0,
          attributed_records_without_identity_total: agencyMetric?.attributed_records_without_identity_total ?? 0,
          attributed_records_with_strong_identity_total: agencyMetric?.attributed_records_with_strong_identity_total ?? 0,
          attributed_records_customer_total: agencyMetric?.attributed_records_customer_total ?? 0,
          attributed_records_discarded_total: agencyMetric?.attributed_records_discarded_total ?? 0,
          attributed_records_active_total: agencyMetric?.attributed_records_active_total ?? 0,
          leads_total: agencyMetric?.leads_total ?? 0,
          leads_open_total: agencyMetric?.leads_open_total ?? 0,
          leads_converted_total: agencyMetric?.leads_converted_total ?? 0,
          leads_won_total: agencyMetric?.leads_won_total ?? 0,
          converted_clients_total: agencyMetric?.converted_clients_total ?? 0,
          linked_contacts_total: agencyMetric?.linked_contacts_total ?? 0,
          linked_clients_total: agencyMetric?.linked_clients_total ?? 0,
          linked_reserved_clients_total: agencyMetric?.linked_reserved_clients_total ?? 0,
          projects_total: attributedAgency?.project_mix?.length ?? agencyMetric?.projects_total ?? 0,
          lead_conversion_rate_pct: agencyMetric?.lead_conversion_rate_pct ?? 0,
          lead_to_client_rate_pct: agencyMetric?.lead_to_client_rate_pct ?? 0,
          linked_client_reservation_rate_pct: agencyMetric?.linked_client_reservation_rate_pct ?? 0,
          attributed_to_linked_client_rate_pct: agencyMetric?.attributed_to_linked_client_rate_pct ?? 0,
        },
        charts: {
          monthly_leads: attributedMonthly.length
            ? attributedMonthly.slice(-6).map((row) => ({
                month_key: row.month_key,
                month_label: row.month_label,
                total: row.total,
                with_identity_total: row.with_identity_total,
                without_identity_total: row.without_identity_total,
                customer_total: row.customer_total,
                discarded_total: row.discarded_total,
                active_total: row.active_total,
              }))
            : [...monthlyMap.values()]
                .sort((a, b) => a.key.localeCompare(b.key))
                .slice(-6)
                .map((row) => ({
                  month_key: row.key,
                  month_label: monthLabelFromKey(row.key),
                  total: row.total,
                  with_identity_total: row.total,
                  without_identity_total: 0,
                  customer_total: row.converted_clients.size,
                  discarded_total: 0,
                  active_total: row.total,
                })),
          status_breakdown: attributedStatusBreakdown.length
            ? attributedStatusBreakdown
            : [...statusMap.entries()]
                .map(([status, total]) => ({ status_label: status, total }))
                .sort((a, b) => b.total - a.total),
          project_mix: (attributedProjectMix.length
            ? attributedProjectMix.map((row) => {
                const dbProject = [...projectMap.values()].find(
                  (entry) =>
                    getPropertyDisplayNameFromRow(context.propertyById.get(entry.project_id) ?? {}) === row.project_label
                );
                return {
                  project_id: dbProject?.project_id ?? null,
                  project_label: row.project_label || "Proyecto",
                  project_legacy_code: row.project_legacy_code,
                  attributed_records_total: row.total,
                  with_identity_total: row.with_identity_total,
                  customer_total: row.customer_total,
                  discarded_total: row.discarded_total,
                  linked_clients_total: dbProject?.linked_clients_total ?? 0,
                  crm_leads_total: dbProject?.leads_total ?? 0,
                  converted_clients_total: dbProject?.converted_clients_total ?? 0,
                };
              })
            : [...projectMap.values()].map((row) => {
                const propertyRow = context.propertyById.get(row.project_id) ?? null;
                return {
                  project_id: row.project_id,
                  project_label:
                    getPropertyDisplayNameFromRow(propertyRow ?? {}) ??
                    asText(propertyRow?.legacy_code) ??
                    "Proyecto",
                  project_legacy_code: asText(propertyRow?.legacy_code),
                  attributed_records_total: row.leads_total,
                  with_identity_total: row.leads_total,
                  customer_total: row.converted_clients_total,
                  discarded_total: 0,
                  linked_clients_total: row.linked_clients_total,
                  crm_leads_total: row.leads_total,
                  converted_clients_total: row.converted_clients_total,
                };
              }))
            .sort(
              (a, b) =>
                b.attributed_records_total - a.attributed_records_total ||
                b.linked_clients_total - a.linked_clients_total
            )
            .slice(0, 8),
        },
        contacts: agencyContactRows.map((row) => ({
          id: row.agency_contact_id,
          agency_contact_id: row.agency_contact_id,
          contact_id: row.contact_id,
          agency_id: row.agency_id,
          full_name: row.full_name,
          email: row.email,
          phone: row.phone,
          role: row.role,
          relation_status: row.relation_status,
          is_primary: row.is_primary,
          leads_total: row.leads_total,
          leads_open_total: row.leads_open_total,
          leads_converted_total: row.leads_converted_total,
          converted_clients_total: row.converted_clients_total,
          reserved_clients_total: row.reserved_clients_total,
          lead_conversion_rate_pct: row.lead_conversion_rate_pct,
        })),
        crm_leads: crmLeads.slice(0, 20),
        attributed_lead_samples: attributedLeadSamples,
        clients_brought: clientsBrought.slice(0, 20),
        linked_clients: clientsBrought.slice(0, 20),
        contact_summary: {
          active_contacts_total: agencyContactRows.length,
          contacts_with_leads_total: agencyContactRows.filter((row) => row.leads_total > 0).length,
        },
      },
      meta: {
        organization_id: organizationId,
        storage: "supabase.crm.agencies + crm.clients.profile_data + crm.leads + crm.agency_contacts + crm.client_project_reservations",
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "crm_agency_detail_unhandled_error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
};

export const POST: APIRoute = async () => methodNotAllowed(["GET", "PATCH", "DELETE"]);

export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  const agencyId = asUuid(params.id);
  if (!agencyId) return jsonResponse({ ok: false, error: "invalid_agency_id" }, { status: 400 });

  const body = await parseJsonBody<AgencyUpdateInput & { organization_id?: string | null }>(request);
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
    const updated = await updateAgencyBundle(client, organizationId, agencyId, body);
    if (!updated) return jsonResponse({ ok: false, error: "agency_not_found" }, { status: 404 });

    return jsonResponse({
      ok: true,
      data: {
        agency_id: asUuid(updated.agency.id),
        client_id: asUuid(updated.client?.id),
        contact_id: asUuid(updated.contact?.id),
        full_name: asText(updated.client?.billing_name),
        agency_status: asText(updated.agency.agency_status),
        client_status: asText(updated.client?.client_status),
      },
      meta: {
        organization_id: organizationId,
        storage: "supabase.crm.contacts + crm.clients + crm.agencies",
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "crm_agency_update_unhandled_error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
};

export const DELETE: APIRoute = async ({ params, url, cookies }) => {
  const agencyId = asUuid(params.id);
  if (!agencyId) return jsonResponse({ ok: false, error: "invalid_agency_id" }, { status: 400 });

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
    const current = await readAgencyBundle(client, organizationId, agencyId);
    if (!current) return jsonResponse({ ok: false, error: "agency_not_found" }, { status: 404 });

    const archived = await archiveAgencyBundle(client, organizationId, agencyId);
    return jsonResponse({
      ok: true,
      data: {
        agency_id: agencyId,
        archived: true,
        agency_status: asText(archived?.agency.agency_status),
        client_status: asText(archived?.client?.client_status),
      },
      meta: {
        organization_id: organizationId,
        mode: "archive",
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "crm_agency_archive_unhandled_error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
};
