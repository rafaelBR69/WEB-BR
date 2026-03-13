import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { resolveCrmOrgAccess } from "@shared/crm/access";
import { getSupabaseServerClient } from "@shared/supabase/server";
import { asText, asUuid } from "@shared/portal/domain";
import { buildAgencyAnalyticsContext, buildAgencyContactMetrics, buildAgencyMetrics } from "@shared/agencies/analytics";
import { mergeAgencyBundle, mergeAgencyContactBundle } from "@shared/agencies/crud";

const asObjectRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const normalizeName = (value: unknown) => {
  const text = asText(value);
  if (!text) return null;
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
};

const normalizeBrandKey = (value: unknown) => {
  const normalized = normalizeName(value);
  return normalized ? normalized.replace(/\s+/g, "") : null;
};

const normalizeEmail = (value: unknown) => {
  const text = asText(value)?.toLowerCase();
  if (!text) return null;
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
};

const normalizePhone = (value: unknown) => {
  const text = asText(value);
  if (!text) return null;
  const digits = text.replace(/\D+/g, "");
  return digits.length >= 6 ? digits : null;
};

const buildAgencyLabel = (
  agencyRow: Record<string, unknown>,
  clientRow: Record<string, unknown> | null,
  contactRow: Record<string, unknown> | null
) =>
  asText(clientRow?.billing_name) ??
  asText(asObjectRecord(clientRow?.profile_data).agency_name) ??
  asText(asObjectRecord(clientRow?.profile_data).agent_name) ??
  asText(contactRow?.full_name) ??
  asText(agencyRow.agency_code) ??
  "Agencia";

const isQuestionName = (value: unknown) => {
  const text = asText(value);
  if (!text) return true;
  return /^(\?|\u00bf)+$/.test(text.trim());
};

const isGenericContactName = (contactName: unknown, agencyName: unknown) => {
  if (isQuestionName(contactName)) return true;
  const normalizedContact = normalizeName(contactName);
  const normalizedAgency = normalizeName(agencyName);
  if (!normalizedContact) return true;
  if (!normalizedAgency) return false;
  const compactContact = normalizedContact.replace(/\s+/g, "");
  const compactAgency = normalizedAgency.replace(/\s+/g, "");
  return (
    compactContact === compactAgency ||
    compactContact.includes(compactAgency) ||
    compactAgency.includes(compactContact)
  );
};

const GET_GROUP_LIMIT = 100;

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
    const agencyMetricsById = new Map(buildAgencyMetrics(context).map((row) => [row.agency_id, row]));
    const contactMetricsById = new Map(buildAgencyContactMetrics(context).map((row) => [row.agency_contact_id, row]));

    const agencyGroupsMap = new Map<
      string,
      Array<{
        agency_id: string;
        agency_name: string;
        agency_code: string | null;
        agency_status: string | null;
        tax_id: string | null;
        client_id: string | null;
        base_contact_name: string | null;
        base_contact_email: string | null;
        linked_contacts_total: number;
        linked_clients_total: number;
        attributed_records_total: number;
        leads_total: number;
        score: number;
      }>
    >();

    context.agencies.forEach((agencyRow) => {
      const agencyId = asUuid(agencyRow.id);
      if (!agencyId) return;
      const baseClient = context.clientById.get(asUuid(agencyRow.client_id) ?? "") ?? null;
      const baseContact = context.contactById.get(asUuid(baseClient?.contact_id) ?? "") ?? null;
      const agencyName = buildAgencyLabel(agencyRow, baseClient, baseContact);
      const brandKey = normalizeBrandKey(agencyName);
      if (!brandKey) return;
      const metric = agencyMetricsById.get(agencyId) ?? null;
      const item = {
        agency_id: agencyId,
        agency_name: agencyName,
        agency_code: asText(agencyRow.agency_code),
        agency_status: asText(agencyRow.agency_status),
        tax_id: asText(baseClient?.tax_id),
        client_id: asUuid(baseClient?.id),
        base_contact_name: asText(baseContact?.full_name),
        base_contact_email: asText(baseContact?.email),
        linked_contacts_total: Number(metric?.linked_contacts_total ?? 0),
        linked_clients_total: Number(metric?.linked_clients_total ?? 0),
        attributed_records_total: Number(metric?.attributed_records_total ?? 0),
        leads_total: Number(metric?.leads_total ?? 0),
        score:
          Number(metric?.linked_clients_total ?? 0) * 100 +
          Number(metric?.attributed_records_total ?? 0) * 10 +
          Number(metric?.leads_total ?? 0) * 8 +
          Number(metric?.linked_contacts_total ?? 0) * 5 +
          Number(Boolean(asText(baseClient?.tax_id))) * 3,
      };
      const bucket = agencyGroupsMap.get(brandKey) ?? [];
      bucket.push(item);
      agencyGroupsMap.set(brandKey, bucket);
    });

    const agencyGroups = [...agencyGroupsMap.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([brandKey, rows]) => {
        const sortedRows = [...rows].sort(
          (a, b) =>
            b.score - a.score ||
            b.linked_clients_total - a.linked_clients_total ||
            b.attributed_records_total - a.attributed_records_total ||
            a.agency_name.localeCompare(b.agency_name, "es")
        );
        const canonical = sortedRows[0];
        return {
          group_key: brandKey,
          group_label: canonical.agency_name,
          recommended_canonical_agency_id: canonical.agency_id,
          total_rows: sortedRows.length,
          total_linked_clients: sortedRows.reduce((sum, row) => sum + row.linked_clients_total, 0),
          total_attributed_records: sortedRows.reduce((sum, row) => sum + row.attributed_records_total, 0),
          rows: sortedRows,
        };
      })
      .sort(
        (a, b) =>
          b.total_linked_clients - a.total_linked_clients ||
          b.total_attributed_records - a.total_attributed_records ||
          b.total_rows - a.total_rows
      )
      .slice(0, GET_GROUP_LIMIT);

    const contactGroupsMap = new Map<
      string,
      Array<{
        agency_contact_id: string;
        agency_id: string;
        agency_name: string;
        contact_id: string | null;
        full_name: string | null;
        email: string | null;
        phone: string | null;
        role: string | null;
        relation_status: string | null;
        is_primary: boolean;
        attributed_records_total: number;
        attributed_customer_total: number;
        leads_total: number;
        score: number;
      }>
    >();

    context.agencyContacts.forEach((agencyContactRow) => {
      const agencyContactId = asUuid(agencyContactRow.id);
      const agencyId = asUuid(agencyContactRow.agency_id);
      const contactId = asUuid(agencyContactRow.contact_id);
      if (!agencyContactId || !agencyId || !contactId) return;
      const contactRow = context.contactById.get(contactId) ?? null;
      const agencyName = context.agencyLabelById.get(agencyId) ?? "Agencia";
      const role = asText(agencyContactRow.role) ?? "agent";
      const email = normalizeEmail(contactRow?.email);
      const phone = normalizePhone(contactRow?.phone);
      const fullName = asText(contactRow?.full_name);
      const identity =
        email ? `email:${email}` : phone ? `phone:${phone}` : normalizeName(contactRow?.full_name) ? `name:${normalizeName(contactRow?.full_name)}` : null;
      if (!identity) return;
      const metric = contactMetricsById.get(agencyContactId) ?? null;
      const item = {
        agency_contact_id: agencyContactId,
        agency_id: agencyId,
        agency_name: agencyName,
        contact_id: contactId,
        full_name: fullName,
        email: asText(contactRow?.email),
        phone: asText(contactRow?.phone),
        role,
        relation_status: asText(agencyContactRow.relation_status),
        is_primary: agencyContactRow.is_primary === true,
        attributed_records_total: Number(metric?.attributed_records_total ?? 0),
        attributed_customer_total: Number(metric?.attributed_customer_total ?? 0),
        leads_total: Number(metric?.leads_total ?? 0),
        score:
          Number(metric?.attributed_customer_total ?? 0) * 100 +
          Number(metric?.attributed_records_total ?? 0) * 12 +
          Number(metric?.leads_total ?? 0) * 8 +
          Number(agencyContactRow.is_primary === true) * 10 +
          Number(!isGenericContactName(contactRow?.full_name, agencyName)) * 5,
      };
      const key = `${agencyId}|${role}|${identity}`;
      const bucket = contactGroupsMap.get(key) ?? [];
      bucket.push(item);
      contactGroupsMap.set(key, bucket);
    });

    const contactGroups = [...contactGroupsMap.entries()]
      .filter(([, rows]) => rows.length > 1 && new Set(rows.map((row) => row.contact_id)).size > 1)
      .map(([groupKey, rows]) => {
        const sortedRows = [...rows].sort(
          (a, b) =>
            b.score - a.score ||
            b.attributed_customer_total - a.attributed_customer_total ||
            b.attributed_records_total - a.attributed_records_total ||
            Number(b.is_primary) - Number(a.is_primary) ||
            String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""), "es")
        );
        const canonical = sortedRows[0];
        return {
          group_key: groupKey,
          group_label: canonical.full_name ?? canonical.email ?? canonical.phone ?? canonical.agency_name,
          recommended_canonical_agency_contact_id: canonical.agency_contact_id,
          agency_id: canonical.agency_id,
          agency_name: canonical.agency_name,
          total_rows: sortedRows.length,
          total_attributed_records: sortedRows.reduce((sum, row) => sum + row.attributed_records_total, 0),
          total_attributed_customers: sortedRows.reduce((sum, row) => sum + row.attributed_customer_total, 0),
          rows: sortedRows,
        };
      })
      .sort(
        (a, b) =>
          b.total_attributed_customers - a.total_attributed_customers ||
          b.total_attributed_records - a.total_attributed_records ||
          b.total_rows - a.total_rows
      )
      .slice(0, GET_GROUP_LIMIT);

    return jsonResponse({
      ok: true,
      data: {
        agencies: agencyGroups,
        contacts: contactGroups,
      },
      meta: {
        organization_id: organizationId,
        summary: {
          agency_groups_total: agencyGroups.length,
          contact_groups_total: contactGroups.length,
        },
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "crm_agency_duplicates_unhandled_error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await parseJsonBody<{
    organization_id?: string | null;
    entity?: string | null;
    canonical_id?: string | null;
    duplicate_id?: string | null;
  }>(request);
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
  const entity = asText(body.entity);
  const canonicalId = asUuid(body.canonical_id);
  const duplicateId = asUuid(body.duplicate_id);
  if (!entity || !canonicalId || !duplicateId) {
    return jsonResponse({ ok: false, error: "invalid_merge_params" }, { status: 422 });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  try {
    if (entity === "contact") {
      const merged = await mergeAgencyContactBundle(client, organizationId, canonicalId, duplicateId);
      if (!merged) return jsonResponse({ ok: false, error: "agency_contact_not_found" }, { status: 404 });
      return jsonResponse({
        ok: true,
        data: {
          entity,
          canonical_agency_contact_id: merged.canonical_agency_contact_id,
          duplicate_agency_contact_id: merged.duplicate_agency_contact_id,
          duplicate_contact_deleted: merged.duplicate_contact_deleted,
        },
        meta: {
          organization_id: organizationId,
        },
      });
    }

    if (entity === "agency") {
      const merged = await mergeAgencyBundle(client, organizationId, canonicalId, duplicateId);
      if (!merged) return jsonResponse({ ok: false, error: "agency_not_found" }, { status: 404 });
      return jsonResponse({
        ok: true,
        data: {
          entity,
          canonical_agency_id: merged.canonical_agency_id,
          duplicate_agency_id: merged.duplicate_agency_id,
        },
        meta: {
          organization_id: organizationId,
        },
      });
    }

    return jsonResponse({ ok: false, error: "invalid_merge_entity" }, { status: 422 });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "crm_agency_duplicate_merge_unhandled_error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
};

export const PATCH: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
