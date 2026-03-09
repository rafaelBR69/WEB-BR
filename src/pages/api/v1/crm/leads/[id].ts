import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { getSupabaseServerClient } from "@/utils/supabaseServer";
import { asText, asUuid, asNumber } from "@/utils/crmPortal";
import { 
  LEAD_SELECT_COLUMNS, 
  CONTACT_SELECT_COLUMNS, 
  PROPERTY_SELECT_COLUMNS,
  buildLeadRows,
  normalizeLeadStatus,
  normalizeLeadKind,
  normalizeOperationInterest 
} from "@/utils/crmLeads";

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

const collectStringLeaves = (
  value: unknown,
  prefix = "",
  out: Array<{ path: string; value: string }> = []
) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStringLeaves(item, prefix ? `${prefix}[${index}]` : `[${index}]`, out));
    return out;
  }
  if (!value || typeof value !== "object") {
    const text = asText(value);
    if (text) out.push({ path: prefix, value: text });
    return out;
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    collectStringLeaves(nested, nextPrefix, out);
  });
  return out;
};

const findRawPayloadValue = (rawPayload: Record<string, unknown>, patterns: RegExp[]) => {
  const leaves = collectStringLeaves(rawPayload);
  for (const leaf of leaves) {
    if (patterns.some((pattern) => pattern.test(leaf.path))) {
      return leaf.value;
    }
  }
  return null;
};

const loadAgencySource = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  organizationId: string,
  leadRow: Record<string, unknown>
) => {
  const rawPayload = asObjectRecord(leadRow.raw_payload);
  const mappedPayload = asObjectRecord(rawPayload.mapped);
  const leadAgencyId = asUuid(leadRow.agency_id);
  const rawAgencyName = firstText(
    mappedPayload.agency_name,
    mappedPayload.agency,
    findRawPayloadValue(rawPayload, [/agency_name/i, /nombre agencia/i, /(^|\.)(agencia)($|\.)/i])
  );
  const rawAgencyAgentName = firstText(
    mappedPayload.agency_contact_name,
    mappedPayload.agent_name,
    findRawPayloadValue(rawPayload, [/agente agencia/i, /agency agent/i, /agency_contact/i, /contacto_agencia/i])
  );

  if (leadAgencyId) {
    const { data: agencyRow } = await client
      .schema("crm")
      .from("agencies")
      .select("id, client_id, agency_code, agency_status, agency_scope, notes")
      .eq("id", leadAgencyId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    const agencyClientId = asUuid((agencyRow as Record<string, unknown> | null)?.client_id);
    const { data: agencyClient } = agencyClientId
      ? await client
          .schema("crm")
          .from("clients")
          .select("id, client_code, client_status, billing_name, profile_data, contact_id")
          .eq("id", agencyClientId)
          .eq("organization_id", organizationId)
          .maybeSingle()
      : { data: null };

    const agencyBaseContactId = asUuid((agencyClient as Record<string, unknown> | null)?.contact_id);
    const { data: agencyBaseContact } = agencyBaseContactId
      ? await client
          .schema("crm")
          .from("contacts")
          .select("id, full_name, email, phone")
          .eq("id", agencyBaseContactId)
          .eq("organization_id", organizationId)
          .maybeSingle()
      : { data: null };

    const { data: agencyContactRows } = await client
      .schema("crm")
      .from("agency_contacts")
      .select("id, contact_id, role, relation_status, is_primary")
      .eq("agency_id", leadAgencyId)
      .eq("organization_id", organizationId);

    const primaryAgencyContactRow =
      (agencyContactRows ?? []).find((row) => row.relation_status === "active" && row.is_primary) ??
      (agencyContactRows ?? []).find((row) => row.relation_status === "active") ??
      null;
    const primaryAgencyContactId = asUuid(primaryAgencyContactRow?.contact_id);
    const { data: primaryAgencyContact } = primaryAgencyContactId
      ? await client
          .schema("crm")
          .from("contacts")
          .select("id, full_name, email, phone")
          .eq("id", primaryAgencyContactId)
          .eq("organization_id", organizationId)
          .maybeSingle()
      : { data: null };

    const agencyProfile = asObjectRecord((agencyClient as Record<string, unknown> | null)?.profile_data);
    return {
      linked: true,
      agency_id: leadAgencyId,
      agency_name: firstText(
        (agencyClient as Record<string, unknown> | null)?.billing_name,
        agencyProfile.agency_name,
        rawAgencyName
      ),
      agency_code: asText((agencyRow as Record<string, unknown> | null)?.agency_code),
      agency_status: asText((agencyRow as Record<string, unknown> | null)?.agency_status),
      agency_scope: asText((agencyRow as Record<string, unknown> | null)?.agency_scope),
      client_id: agencyClientId,
      client_code: asText((agencyClient as Record<string, unknown> | null)?.client_code),
      primary_contact_name: firstText(
        (primaryAgencyContact as Record<string, unknown> | null)?.full_name,
        (agencyBaseContact as Record<string, unknown> | null)?.full_name,
        rawAgencyAgentName
      ),
      email: firstText(
        (primaryAgencyContact as Record<string, unknown> | null)?.email,
        (agencyBaseContact as Record<string, unknown> | null)?.email
      ),
      phone: firstText(
        (primaryAgencyContact as Record<string, unknown> | null)?.phone,
        (agencyBaseContact as Record<string, unknown> | null)?.phone
      ),
      notes: asText((agencyRow as Record<string, unknown> | null)?.notes),
      raw_agency_name: rawAgencyName,
      raw_agency_agent_name: rawAgencyAgentName,
    };
  }

  if (rawAgencyName || rawAgencyAgentName || asText(leadRow.origin_type) === "agency") {
    return {
      linked: false,
      agency_id: null,
      agency_name: rawAgencyName,
      agency_code: null,
      agency_status: null,
      agency_scope: null,
      client_id: null,
      client_code: null,
      primary_contact_name: rawAgencyAgentName,
      email: null,
      phone: null,
      notes: null,
      raw_agency_name: rawAgencyName,
      raw_agency_agent_name: rawAgencyAgentName,
    };
  }

  return null;
};

export const GET: APIRoute = async ({ params, url }) => {
  const leadId = asUuid(params.id);
  const organizationId = asText(url.searchParams.get("organization_id"));

  if (!leadId || !organizationId) {
    return jsonResponse({ ok: false, error: "invalid_params" }, { status: 400 });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const { data: lead, error: leadError } = await client
    .schema("crm")
    .from("leads")
    .select(LEAD_SELECT_COLUMNS)
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .single();

  if (leadError || !lead) {
    return jsonResponse({ ok: false, error: "lead_not_found" }, { status: 404 });
  }

  // Fetch related contact and property for building rows
  const { data: contact } = await client
    .schema("crm")
    .from("contacts")
    .select(CONTACT_SELECT_COLUMNS)
    .eq("id", lead.contact_id)
    .single();

  const { data: property } = lead.property_id 
    ? await client.schema("crm").from("properties").select(PROPERTY_SELECT_COLUMNS).eq("id", lead.property_id).single()
    : { data: null };
  const agencySource = await loadAgencySource(client, organizationId, lead as Record<string, unknown>);

  const contactsById = new Map<string, any>();
  if (contact) contactsById.set(contact.id, contact);
  
  const propertiesById = new Map<string, any>();
  if (property) propertiesById.set(property.id, property);

  const rows = buildLeadRows([lead as any], contactsById, propertiesById);
  const result = rows[0] ? { ...rows[0] } : null;
  if (result) delete (result as any).search_blob;
  if (result) (result as Record<string, unknown>).agency_source = agencySource;
  
  return jsonResponse({ ok: true, data: result });
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const leadId = asUuid(params.id);
  const body = await parseJsonBody<any>(request);
  const organizationId = asText(body?.organization_id);

  if (!leadId || !organizationId) {
    return jsonResponse({ ok: false, error: "invalid_params" }, { status: 400 });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const updatePayload: any = {};
  if (body.status) updatePayload.status = normalizeLeadStatus(body.status, "new");
  if (body.lead_kind) updatePayload.lead_kind = normalizeLeadKind(body.lead_kind, "buyer");
  if (body.operation_interest) updatePayload.operation_interest = normalizeOperationInterest(body.operation_interest, "sale");
  if (body.priority !== undefined) updatePayload.priority = asNumber(body.priority) ?? 3;
  if (body.budget_min !== undefined) updatePayload.budget_min = asNumber(body.budget_min);
  if (body.budget_max !== undefined) updatePayload.budget_max = asNumber(body.budget_max);

  const { data: leadUpdateResult, error: updateError } = await client
    .schema("crm")
    .from("leads")
    .update(updatePayload)
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .select(LEAD_SELECT_COLUMNS)
    .single();

  if (updateError || !leadUpdateResult) {
    return jsonResponse({ ok: false, error: "db_update_error", details: updateError?.message }, { status: 500 });
  }

  // Also update contact if full_name, email, or phone are provided
  if (body.full_name || body.email || body.phone || body.nationality) {
    const contactUpdate: any = {};
    if (body.full_name) contactUpdate.full_name = asText(body.full_name);
    if (body.email) contactUpdate.email = asText(body.email);
    if (body.phone) contactUpdate.phone = asText(body.phone);
    if (body.nationality) contactUpdate.country_code = asText(body.nationality);

    await client
      .schema("crm")
      .from("contacts")
      .update(contactUpdate)
      .eq("id", (leadUpdateResult as any).contact_id);
  }

  // Fetch full data for the response
  const { data: contact } = await client
    .schema("crm")
    .from("contacts")
    .select(CONTACT_SELECT_COLUMNS)
    .eq("id", (leadUpdateResult as any).contact_id)
    .single();

  const { data: property } = (leadUpdateResult as any).property_id 
    ? await client.schema("crm").from("properties").select(PROPERTY_SELECT_COLUMNS).eq("id", (leadUpdateResult as any).property_id).single()
    : { data: null };

  const contactsById = new Map<string, any>();
  if (contact) contactsById.set(contact.id, contact);

  const propertiesById = new Map<string, any>();
  if (property) propertiesById.set(property.id, property);

  const rows = buildLeadRows([leadUpdateResult as any], contactsById, propertiesById);
  const result = rows[0] ? { ...rows[0] } : null;
  if (result) delete (result as any).search_blob;
  if (result) (result as Record<string, unknown>).agency_source = await loadAgencySource(client, organizationId, leadUpdateResult as Record<string, unknown>);

  return jsonResponse({ ok: true, data: result });
};

export const DELETE: APIRoute = async ({ params, url }) => {
  const leadId = asUuid(params.id);
  const organizationId = asText(url.searchParams.get("organization_id"));

  if (!leadId || !organizationId) {
    return jsonResponse({ ok: false, error: "invalid_params" }, { status: 400 });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const { error: deleteError } = await client
    .schema("crm")
    .from("leads")
    .delete()
    .eq("id", leadId)
    .eq("organization_id", organizationId);

  if (deleteError) {
    return jsonResponse({ ok: false, error: "db_delete_error", details: deleteError.message }, { status: 500 });
  }

  return jsonResponse({ ok: true });
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "PATCH", "DELETE"]);
