import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed } from "@/utils/crmApi";
import { resolveCrmOrgAccess } from "@/utils/crmAccess";
import { getSupabaseServerClient } from "@/utils/supabaseServer";
import { asText, asUuid } from "@/utils/crmPortal";
import { buildAgencyAnalyticsContext, buildAgencyContactMetrics, buildAgencyMetrics, monthKeyFromValue, monthLabelFromKey } from "@/utils/crmAgencyAnalytics";
import { getPropertyDisplayNameFromRow } from "@/utils/crmProperties";

export const GET: APIRoute = async ({ url, cookies }) => {
  const organizationIdHint = asText(url.searchParams.get("organization_id"));

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
    const agencyRows = buildAgencyMetrics(context);
    const contactRows = buildAgencyContactMetrics(context);
    const attributedSummary = context.attributedSummary;

    const projectMap = new Map<
      string,
      {
        project_id: string;
        project_label: string;
        project_legacy_code: string | null;
        agencies: Set<string>;
        leads_total: number;
        linked_clients_total: number;
      }
    >();

    context.leads.forEach((lead) => {
      const agencyId = asUuid(lead.agency_id);
      const projectId = asUuid(lead.property_id);
      if (!agencyId || !projectId) return;
      const propertyRow = context.propertyById.get(projectId) ?? null;
      const current = projectMap.get(projectId) ?? {
        project_id: projectId,
        project_label: getPropertyDisplayNameFromRow(propertyRow ?? {}) ?? asText(propertyRow?.legacy_code) ?? "Proyecto",
        project_legacy_code: asText(propertyRow?.legacy_code),
        agencies: new Set<string>(),
        leads_total: 0,
        linked_clients_total: 0,
      };
      current.agencies.add(agencyId);
      current.leads_total += 1;
      projectMap.set(projectId, current);
    });

    context.reservations.forEach((reservation) => {
      const clientId = asUuid(reservation.client_id);
      const projectId = asUuid(reservation.project_property_id);
      if (!clientId || !projectId) return;
      const clientRow = context.clientById.get(clientId) ?? null;
      const profileData =
        clientRow?.profile_data && typeof clientRow.profile_data === "object"
          ? (clientRow.profile_data as Record<string, unknown>)
          : {};
      const agencyId = asUuid(profileData.linked_agency_id);
      if (!agencyId) return;
      const propertyRow = context.propertyById.get(projectId) ?? null;
      const current = projectMap.get(projectId) ?? {
        project_id: projectId,
        project_label: getPropertyDisplayNameFromRow(propertyRow ?? {}) ?? asText(propertyRow?.legacy_code) ?? "Proyecto",
        project_legacy_code: asText(propertyRow?.legacy_code),
        agencies: new Set<string>(),
        leads_total: 0,
        linked_clients_total: 0,
      };
      current.agencies.add(agencyId);
      current.linked_clients_total += 1;
      projectMap.set(projectId, current);
    });

    const monthlyMap = new Map<string, { key: string; total: number; converted: number; converted_clients: Set<string> }>();
    context.leads.forEach((lead) => {
      const agencyId = asUuid(lead.agency_id);
      if (!agencyId) return;
      const key = monthKeyFromValue(lead.created_at);
      if (!key) return;
      const status = asText(lead.status) ?? "new";
      const current = monthlyMap.get(key) ?? { key, total: 0, converted: 0, converted_clients: new Set<string>() };
      current.total += 1;
      if (status === "converted" || status === "won" || asText(lead.converted_at) || asUuid(lead.converted_client_id)) {
        current.converted += 1;
      }
      const convertedClientId = asUuid(lead.converted_client_id);
      if (convertedClientId) current.converted_clients.add(convertedClientId);
      monthlyMap.set(key, current);
    });

    const agenciesTotal = agencyRows.length;
    const activeAgenciesTotal = agencyRows.filter((row) => row.agency_status === "active").length;
    const referralSourcesTotal = agencyRows.filter((row) => row.is_referral_source).length;
    const leadsTotal = agencyRows.reduce((sum, row) => sum + row.leads_total, 0);
    const leadsOpenTotal = agencyRows.reduce((sum, row) => sum + row.leads_open_total, 0);
    const leadsConvertedTotal = agencyRows.reduce((sum, row) => sum + row.leads_converted_total, 0);
    const convertedClientsTotal = agencyRows.reduce((sum, row) => sum + row.converted_clients_total, 0);
    const linkedClientsTotal = agencyRows.reduce((sum, row) => sum + row.linked_clients_total, 0);
    const linkedReservedClientsTotal = agencyRows.reduce((sum, row) => sum + row.linked_reserved_clients_total, 0);
    const attributedRecordsTotal =
      attributedSummary?.overall?.attributed_records_total ??
      agencyRows.reduce((sum, row) => sum + row.attributed_records_total, 0);
    const attributedWithIdentityTotal =
      attributedSummary?.overall?.records_with_identity_total ??
      agencyRows.reduce((sum, row) => sum + row.attributed_records_with_identity_total, 0);
    const attributedWithoutIdentityTotal =
      attributedSummary?.overall?.records_without_identity_total ??
      agencyRows.reduce((sum, row) => sum + row.attributed_records_without_identity_total, 0);
    const attributedCustomerTotal =
      attributedSummary?.overall?.customer_total ??
      agencyRows.reduce((sum, row) => sum + row.attributed_records_customer_total, 0);
    const attributedDiscardedTotal =
      attributedSummary?.overall?.discarded_total ??
      agencyRows.reduce((sum, row) => sum + row.attributed_records_discarded_total, 0);
    const attributedActiveTotal =
      attributedSummary?.overall?.active_total ??
      agencyRows.reduce((sum, row) => sum + row.attributed_records_active_total, 0);

    const topByLeads = [...agencyRows]
      .filter((row) => row.attributed_records_total > 0)
      .sort(
        (a, b) =>
          b.attributed_records_total - a.attributed_records_total ||
          b.linked_clients_total - a.linked_clients_total ||
          b.attributed_records_with_identity_total - a.attributed_records_with_identity_total
      )
      .slice(0, 8);

    const topByClients = [...agencyRows]
      .sort(
        (a, b) =>
          b.linked_clients_total - a.linked_clients_total ||
          b.linked_reserved_clients_total - a.linked_reserved_clients_total ||
          b.attributed_records_total - a.attributed_records_total
      )
      .slice(0, 8);

    const topByConversion = [...agencyRows]
      .filter((row) => row.attributed_records_total > 0)
      .sort(
        (a, b) =>
          b.attributed_to_linked_client_rate_pct - a.attributed_to_linked_client_rate_pct ||
          b.linked_clients_total - a.linked_clients_total
      )
      .slice(0, 8);

    const topContacts = [...contactRows]
      .filter((row) => row.attributed_records_total > 0 || row.leads_total > 0)
      .sort(
        (a, b) =>
          b.attributed_customer_total - a.attributed_customer_total ||
          b.attributed_records_total - a.attributed_records_total ||
          b.converted_clients_total - a.converted_clients_total ||
          b.leads_total - a.leads_total
      )
      .slice(0, 10);

    const topProjects = (attributedSummary?.overall?.project_mix?.length
      ? attributedSummary.overall.project_mix.map((row) => {
          const dbProject = [...projectMap.values()].find(
            (entry) => entry.project_label === row.project_label || entry.project_legacy_code === row.project_legacy_code
          );
          return {
            project_id: dbProject?.project_id ?? null,
            project_label: row.project_label,
            project_legacy_code: row.project_legacy_code,
            agencies_total: dbProject?.agencies.size ?? 0,
            attributed_records_total: row.total,
            attributed_with_identity_total: row.with_identity_total,
            customer_total: row.customer_total,
            discarded_total: row.discarded_total,
            linked_clients_total: dbProject?.linked_clients_total ?? 0,
          };
        })
      : [...projectMap.values()].map((row) => ({
          project_id: row.project_id,
          project_label: row.project_label,
          project_legacy_code: row.project_legacy_code,
          agencies_total: row.agencies.size,
          attributed_records_total: row.leads_total,
          attributed_with_identity_total: row.leads_total,
          customer_total: 0,
          discarded_total: 0,
          linked_clients_total: row.linked_clients_total,
        })))
      .sort(
        (a, b) =>
          b.attributed_records_total - a.attributed_records_total ||
          b.linked_clients_total - a.linked_clients_total
      )
      .slice(0, 8);

    const monthly = attributedSummary?.overall?.monthly_records?.length
      ? attributedSummary.overall.monthly_records.slice(-6).map((row) => ({
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
          }));

    return jsonResponse({
      ok: true,
      data: {
        summary: {
          agencies_total: agenciesTotal,
          active_agencies_total: activeAgenciesTotal,
          referral_sources_total: referralSourcesTotal,
          attributed_records_total: attributedRecordsTotal,
          attributed_records_with_identity_total: attributedWithIdentityTotal,
          attributed_records_without_identity_total: attributedWithoutIdentityTotal,
          attributed_records_customer_total: attributedCustomerTotal,
          attributed_records_discarded_total: attributedDiscardedTotal,
          attributed_records_active_total: attributedActiveTotal,
          matched_attributed_records_total: attributedSummary?.totals?.matched_records_total ?? 0,
          unmatched_attributed_records_total: attributedSummary?.totals?.unmatched_records_total ?? 0,
          ambiguous_attributed_records_total: attributedSummary?.totals?.ambiguous_records_total ?? 0,
          crm_leads_total: leadsTotal,
          leads_total: leadsTotal,
          leads_open_total: leadsOpenTotal,
          leads_converted_total: leadsConvertedTotal,
          converted_clients_total: convertedClientsTotal,
          linked_clients_total: linkedClientsTotal,
          linked_reserved_clients_total: linkedReservedClientsTotal,
          agencies_with_linked_clients_total: agencyRows.filter((row) => row.linked_clients_total > 0).length,
          lead_conversion_rate_pct: leadsTotal > 0 ? Math.round((leadsConvertedTotal / leadsTotal) * 100) : 0,
          lead_to_client_rate_pct: leadsTotal > 0 ? Math.round((convertedClientsTotal / leadsTotal) * 100) : 0,
          attributed_to_linked_client_rate_pct:
            attributedRecordsTotal > 0 ? Math.round((linkedClientsTotal / attributedRecordsTotal) * 100) : 0,
          linked_client_reservation_rate_pct:
            linkedClientsTotal > 0 ? Math.round((linkedReservedClientsTotal / linkedClientsTotal) * 100) : 0,
          agency_contacts_total: contactRows.filter((row) => row.relation_status === "active").length,
          agency_contacts_with_leads_total: contactRows.filter((row) => row.leads_total > 0).length,
        },
        monthly,
        top_by_leads: topByLeads,
        top_by_clients: topByClients,
        top_by_conversion: topByConversion,
        top_projects: topProjects,
        top_contacts: topContacts,
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
        error: "crm_agencies_dashboard_unhandled_error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
};

export const POST: APIRoute = async () => methodNotAllowed(["GET"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET"]);
