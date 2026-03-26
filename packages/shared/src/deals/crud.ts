import { CLIENT_CONTACT_SELECT_COLUMNS } from "../clients/domain.ts";
import { DEAL_SELECT_COLUMNS, buildDealTitle, isDealTerminalStage, mapDealRow, normalizeDealStage } from "./domain.ts";
import { LEAD_SELECT_COLUMNS, normalizeLeadStatus } from "../leads/domain.ts";
import { asNumber, asText, asUuid } from "../portal/domain.ts";

const DEAL_PROPERTY_SELECT_COLUMNS = [
  "id",
  "legacy_code",
  "translations",
  "property_data",
  "parent_property_id",
  "record_type",
  "status",
].join(", ");

const DEAL_CLIENT_SELECT_COLUMNS = ["id", "organization_id", "contact_id", "client_code", "client_status", "billing_name"].join(", ");
const IN_QUERY_CHUNK_SIZE = 200;

const openQueryBase = (client: any, organizationId: string) =>
  client.schema("crm").from("deals").select(DEAL_SELECT_COLUMNS).eq("organization_id", organizationId);

const dedupeUuids = (values: Array<string | null | undefined>) =>
  Array.from(new Set(values.map((value) => asUuid(value ?? null)).filter((value): value is string => Boolean(value))));

const readRowsByIds = async (
  client: any,
  organizationId: string,
  input: {
    table: "contacts" | "leads" | "clients" | "properties";
    select: string;
    ids: string[];
    errorPrefix: string;
  }
) => {
  const uniqueIds = dedupeUuids(input.ids);
  const byId = new Map<string, Record<string, unknown>>();
  if (!uniqueIds.length) return byId;

  for (let index = 0; index < uniqueIds.length; index += IN_QUERY_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(index, index + IN_QUERY_CHUNK_SIZE);
    const { data, error } = await client
      .schema("crm")
      .from(input.table)
      .select(input.select)
      .eq("organization_id", organizationId)
      .in("id", chunk);

    if (error) throw new Error(`${input.errorPrefix}:${error.message}`);
    (data ?? []).forEach((row: Record<string, unknown>) => {
      const id = asUuid(row.id);
      if (!id) return;
      byId.set(id, row);
    });
  }

  return byId;
};

const readContactsByIds = async (client: any, organizationId: string, ids: string[]) => {
  const uniqueIds = dedupeUuids(ids);
  return readRowsByIds(client, organizationId, {
    table: "contacts",
    select: CLIENT_CONTACT_SELECT_COLUMNS,
    ids: uniqueIds,
    errorPrefix: "db_contacts_read_error",
  });
};

const readLeadsByIds = async (client: any, organizationId: string, ids: string[]) => {
  const uniqueIds = dedupeUuids(ids);
  return readRowsByIds(client, organizationId, {
    table: "leads",
    select: LEAD_SELECT_COLUMNS,
    ids: uniqueIds,
    errorPrefix: "db_leads_read_error",
  });
};

const readClientsByIds = async (client: any, organizationId: string, ids: string[]) => {
  const uniqueIds = dedupeUuids(ids);
  return readRowsByIds(client, organizationId, {
    table: "clients",
    select: DEAL_CLIENT_SELECT_COLUMNS,
    ids: uniqueIds,
    errorPrefix: "db_clients_read_error",
  });
};

const readPropertiesByIds = async (client: any, organizationId: string, ids: string[]) => {
  const uniqueIds = dedupeUuids(ids);
  return readRowsByIds(client, organizationId, {
    table: "properties",
    select: DEAL_PROPERTY_SELECT_COLUMNS,
    ids: uniqueIds,
    errorPrefix: "db_properties_read_error",
  });
};

const isOperationalDealPropertyRow = (row: Record<string, unknown> | null) => {
  if (!row) return false;
  const recordType = asText(row.record_type);
  const status = asText(row.status);
  return (recordType === "unit" || recordType === "single") && status !== "archived";
};

export const resolveDealPropertyForWrite = async (
  client: any,
  organizationId: string,
  propertyId: string | null,
  options: { allowDerivedSkip?: boolean } = {}
) => {
  const normalizedPropertyId = asUuid(propertyId);
  if (!normalizedPropertyId) {
    return { propertyId: null, row: null };
  }

  const row = (await readPropertiesByIds(client, organizationId, [normalizedPropertyId])).get(normalizedPropertyId) ?? null;
  if (!row) throw new Error("property_not_found_for_deal");

  if (!isOperationalDealPropertyRow(row)) {
    if (options.allowDerivedSkip) {
      return { propertyId: null, row: null };
    }
    if (asText(row.status) === "archived") throw new Error("property_archived_for_deal");
    throw new Error("invalid_deal_property_record_type");
  }

  return { propertyId: normalizedPropertyId, row };
};

export const hydrateDealRows = async (
  client: any,
  organizationId: string,
  rows: Array<Record<string, unknown>>
) => {
  const leadIds = dedupeUuids(rows.map((row) => asText(row.lead_id)));
  const clientIds = dedupeUuids(rows.map((row) => asText(row.client_id)));
  const propertyIds = dedupeUuids(rows.map((row) => asText(row.property_id)));

  const [leadsById, clientsById, propertiesById] = await Promise.all([
    readLeadsByIds(client, organizationId, leadIds),
    readClientsByIds(client, organizationId, clientIds),
    readPropertiesByIds(client, organizationId, propertyIds),
  ]);

  const contactIds = dedupeUuids([
    ...Array.from(leadsById.values()).map((row) => asText(row.contact_id)),
    ...Array.from(clientsById.values()).map((row) => asText(row.contact_id)),
  ]);
  const contactsById = await readContactsByIds(client, organizationId, contactIds);

  return rows.map((row) => {
    const leadId = asUuid(row.lead_id);
    const clientId = asUuid(row.client_id);
    const propertyId = asUuid(row.property_id);
    const leadRow = leadId ? leadsById.get(leadId) ?? null : null;
    const clientRow = clientId ? clientsById.get(clientId) ?? null : null;
    const propertyRow = propertyId ? propertiesById.get(propertyId) ?? null : null;
    const leadContact = leadRow ? contactsById.get(asUuid(leadRow.contact_id) ?? "") ?? null : null;
    const clientContact = clientRow ? contactsById.get(asUuid(clientRow.contact_id) ?? "") ?? null : null;

    const mappedLead = leadRow
      ? {
          id: asUuid(leadRow.id),
          full_name: asText(leadContact?.full_name),
          status: asText(leadRow.status),
        }
      : null;

    const mappedClient = clientRow
      ? {
          id: asUuid(clientRow.id),
          full_name: asText(clientContact?.full_name) ?? asText(clientRow.billing_name),
          billing_name: asText(clientRow.billing_name),
          client_code: asText(clientRow.client_code),
          client_status: asText(clientRow.client_status),
        }
      : null;

    return mapDealRow(row, {
      lead: mappedLead,
      client: mappedClient,
      property: propertyRow,
    });
  });
};

export const readDealById = async (client: any, organizationId: string, dealId: string) => {
  const { data, error } = await openQueryBase(client, organizationId).eq("id", dealId).maybeSingle();
  if (error) throw new Error(`db_deal_read_error:${error.message}`);
  return (data as Record<string, unknown> | null) ?? null;
};

export const readDealsByLeadId = async (client: any, organizationId: string, leadId: string) => {
  const normalizedLeadId = asUuid(leadId);
  if (!normalizedLeadId) return [];
  const { data, error } = await openQueryBase(client, organizationId)
    .eq("lead_id", normalizedLeadId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`db_lead_deals_read_error:${error.message}`);
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
};

export const readDealsByClientId = async (client: any, organizationId: string, clientId: string) => {
  const normalizedClientId = asUuid(clientId);
  if (!normalizedClientId) return [];
  const { data, error } = await openQueryBase(client, organizationId)
    .eq("client_id", normalizedClientId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`db_client_deals_read_error:${error.message}`);
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
};

export const findEquivalentOpenDeal = async (
  client: any,
  organizationId: string,
  input: {
    leadId?: string | null;
    clientId?: string | null;
    propertyId?: string | null;
  }
) => {
  const leadId = asUuid(input.leadId ?? null);
  const clientId = asUuid(input.clientId ?? null);
  const propertyId = asUuid(input.propertyId ?? null);

  if (leadId) {
    const { data, error } = await openQueryBase(client, organizationId).eq("lead_id", leadId).order("updated_at", { ascending: false });
    if (error) throw new Error(`db_deals_read_error:${error.message}`);
    const rows = ((data ?? []) as Array<Record<string, unknown>>).filter((row) => !isDealTerminalStage(row.stage));
    const exact = propertyId ? rows.find((row) => asUuid(row.property_id) === propertyId) : rows[0];
    return exact ?? null;
  }

  if (clientId) {
    const { data, error } = await openQueryBase(client, organizationId).eq("client_id", clientId).order("updated_at", { ascending: false });
    if (error) throw new Error(`db_deals_read_error:${error.message}`);
    const rows = ((data ?? []) as Array<Record<string, unknown>>).filter((row) => !isDealTerminalStage(row.stage));
    const exact = propertyId
      ? rows.find((row) => asUuid(row.property_id) === propertyId && !asUuid(row.lead_id))
      : rows.find((row) => !asUuid(row.lead_id)) ?? rows[0];
    return exact ?? null;
  }

  return null;
};

export const createOrReuseDeal = async (
  client: any,
  input: {
    organizationId: string;
    leadId?: string | null;
    clientId?: string | null;
    propertyId?: string | null;
    title?: string | null;
    stage?: string | null;
    expectedCloseDate?: string | null;
    expectedValue?: number | null;
    currency?: string | null;
    probability?: number | null;
    ownerId?: string | null;
  }
) => {
  const organizationId = input.organizationId;
  const leadId = asUuid(input.leadId ?? null);
  let clientId = asUuid(input.clientId ?? null);
  let propertyId = asUuid(input.propertyId ?? null);
  const ownerId = asUuid(input.ownerId ?? null);
  let propertyRow: Record<string, unknown> | null = null;

  if (!leadId && !clientId) throw new Error("lead_or_client_required");

  if (propertyId) {
    const resolvedProperty = await resolveDealPropertyForWrite(client, organizationId, propertyId);
    propertyId = resolvedProperty.propertyId;
    propertyRow = resolvedProperty.row;
  }

  const existing = await findEquivalentOpenDeal(client, organizationId, { leadId, clientId, propertyId });
  if (existing) return { row: existing, created: false };

  const [leadRows, clientRows, propertyRows] = await Promise.all([
    readLeadsByIds(client, organizationId, leadId ? [leadId] : []),
    readClientsByIds(client, organizationId, clientId ? [clientId] : []),
    readPropertiesByIds(client, organizationId, propertyId ? [propertyId] : []),
  ]);

  const leadRow = leadId ? leadRows.get(leadId) ?? null : null;
  if (leadId && !leadRow) throw new Error("lead_not_found_for_deal");
  if (!clientId && leadRow) {
    clientId = asUuid(leadRow.converted_client_id);
  }
  if (!propertyId && leadRow) {
    const derivedProperty = await resolveDealPropertyForWrite(
      client,
      organizationId,
      asText(leadRow.property_id),
      { allowDerivedSkip: true }
    );
    propertyId = derivedProperty.propertyId;
    propertyRow = derivedProperty.row;
  }
  const clientRow =
    clientId && clientRows.has(clientId)
      ? clientRows.get(clientId) ?? null
      : clientId
        ? (await readClientsByIds(client, organizationId, [clientId])).get(clientId) ?? null
        : null;
  if (clientId && !clientRow) throw new Error("client_not_found_for_deal");
  if (!propertyRow) {
    propertyRow =
      propertyId && propertyRows.has(propertyId)
        ? propertyRows.get(propertyId) ?? null
        : propertyId
          ? (await readPropertiesByIds(client, organizationId, [propertyId])).get(propertyId) ?? null
          : null;
  }
  if (propertyId && !propertyRow) throw new Error("property_not_found_for_deal");

  const contactIds = dedupeUuids([asText(leadRow?.contact_id), asText(clientRow?.contact_id)]);
  const contactsById = await readContactsByIds(client, organizationId, contactIds);

  const leadContact = leadRow ? contactsById.get(asUuid(leadRow.contact_id) ?? "") ?? null : null;
  const clientContact = clientRow ? contactsById.get(asUuid(clientRow.contact_id) ?? "") ?? null : null;

  const title =
    asText(input.title) ??
    buildDealTitle({
      lead: leadRow ? { ...leadRow, full_name: asText(leadContact?.full_name) } : null,
      client: clientRow ? { ...clientRow, full_name: asText(clientContact?.full_name) } : null,
      property: propertyRow,
    });

  const { data, error } = await client
    .schema("crm")
    .from("deals")
    .insert({
      organization_id: organizationId,
      lead_id: leadId,
      client_id: clientId,
      property_id: propertyId,
      title,
      stage: normalizeDealStage(input.stage),
      expected_close_date: asText(input.expectedCloseDate),
      expected_value: asNumber(input.expectedValue),
      currency: asText(input.currency) ?? "EUR",
      probability: Math.max(0, Math.min(100, asNumber(input.probability) ?? 20)),
      owner_id: ownerId,
    })
    .select(DEAL_SELECT_COLUMNS)
    .single();

  if (error || !data) throw new Error(`db_deal_create_error:${error?.message ?? "insert_failed"}`);
  return { row: data as Record<string, unknown>, created: true };
};

export const syncLeadStatusFromDealStage = async (
  client: any,
  organizationId: string,
  leadId: string | null,
  stage: unknown
) => {
  const normalizedLeadId = asUuid(leadId);
  if (!normalizedLeadId) return;
  const normalizedStage = normalizeDealStage(stage);
  if (normalizedStage !== "won" && normalizedStage !== "lost") return;

  const { data: leadRow, error: leadError } = await client
    .schema("crm")
    .from("leads")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("id", normalizedLeadId)
    .maybeSingle();

  if (leadError) throw new Error(`db_lead_sync_read_error:${leadError.message}`);
  if (!leadRow) return;

  const currentStatus = normalizeLeadStatus(asText((leadRow as Record<string, unknown>).status), "new");
  let nextStatus = currentStatus;

  if (normalizedStage === "won") {
    nextStatus = "converted";
  } else if (
    normalizedStage === "lost" &&
    currentStatus !== "converted" &&
    currentStatus !== "discarded" &&
    currentStatus !== "junk"
  ) {
    nextStatus = "lost";
  }

  if (currentStatus === nextStatus) return;

  const { error: updateError } = await client
    .schema("crm")
    .from("leads")
    .update({ status: nextStatus })
    .eq("organization_id", organizationId)
    .eq("id", normalizedLeadId);

  if (updateError) throw new Error(`db_lead_sync_update_error:${updateError.message}`);
};

export const attachConvertedClientToDeals = async (
  client: any,
  organizationId: string,
  leadId: string | null,
  clientId: string | null
) => {
  const normalizedLeadId = asUuid(leadId);
  const normalizedClientId = asUuid(clientId);
  if (!normalizedLeadId || !normalizedClientId) return;

  const { error } = await client
    .schema("crm")
    .from("deals")
    .update({ client_id: normalizedClientId })
    .eq("organization_id", organizationId)
    .eq("lead_id", normalizedLeadId)
    .is("client_id", null);

  if (error) throw new Error(`db_deal_client_backfill_error:${error.message}`);
};

export const readBlockingDealLinks = async (client: any, organizationId: string, dealId: string) => {
  const [contractsRes, commissionsRes] = await Promise.all([
    client.schema("crm").from("contracts").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("deal_id", dealId),
    client.schema("crm").from("portal_commission_status").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("deal_id", dealId),
  ]);

  if (contractsRes.error) throw new Error(`db_deal_contract_links_error:${contractsRes.error.message}`);
  if (commissionsRes.error) throw new Error(`db_deal_commission_links_error:${commissionsRes.error.message}`);

  return {
    contracts: Number(contractsRes.count ?? 0),
    commissions: Number(commissionsRes.count ?? 0),
  };
};
