import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";
import {
  type AgencyScope,
  type AgencyStatus,
  type ClientEntryChannel,
  type ClientStatus,
  type ClientType,
  type ProviderStatus,
  type ProviderType,
  CLIENT_AGENCY_SELECT_COLUMNS,
  CLIENT_CONTACT_SELECT_COLUMNS,
  CLIENT_PROVIDER_SELECT_COLUMNS,
  CLIENT_SELECT_COLUMNS,
  CLIENT_SELECT_COLUMNS_LEGACY,
  asBoolean,
  asDate,
  asNumber,
  asText,
  buildClientProfileData,
  isMissingProfileDataColumnError,
  mapClientRow,
  normalizeAgencyScope,
  normalizeAgencyStatus,
  normalizeClientStatus,
  normalizeClientType,
  normalizeProviderStatus,
  normalizeProviderType,
} from "@/utils/crmClients";

type CreateClientBody = {
  organization_id?: string;
  client_code?: string | null;
  client_status?: ClientStatus;
  full_name?: string;
  email?: string;
  phone?: string;
  client_type?: ClientType;
  tax_id?: string | null;
  tax_id_type?: "dni" | "nie" | "cif" | "passport" | "other" | null;
  intake_date?: string | null;
  entry_channel?: ClientEntryChannel | null;
  agency_name?: string | null;
  agent_name?: string | null;
  nationality?: string | null;
  budget_amount?: number | null;
  typology?: string | null;
  preferred_location?: string | null;
  comments?: string | null;
  report_notes?: string | null;
  visit_notes?: string | null;
  reservation_notes?: string | null;
  discarded_by?: string | null;
  other_notes?: string | null;
  person_kind?: "fisica" | "juridica" | null;
  as_provider?: boolean | null;
  provider_code?: string | null;
  provider_type?: ProviderType | null;
  provider_status?: ProviderStatus | null;
  provider_is_billable?: boolean | null;
  provider_notes?: string | null;
  as_agency?: boolean | null;
  agency_code?: string | null;
  agency_status?: AgencyStatus | null;
  agency_scope?: AgencyScope | null;
  agency_is_referral_source?: boolean | null;
  agency_notes?: string | null;
};

type ClientRoleFilter = "any" | "provider" | "agency" | "provider_or_agency" | "client_only";

type ClientFilter = {
  organizationId: string | null;
  q: string;
  clientType: ClientType | null;
  clientStatus: ClientStatus | null;
  entryChannel: ClientEntryChannel | null;
  clientRole: ClientRoleFilter;
  projectId: string | null;
  page: number;
  perPage: number;
};

type RelationBundle = {
  providersByClientId: Map<string, Record<string, unknown>>;
  agenciesByClientId: Map<string, Record<string, unknown>>;
  projectLinkedClientIds: Set<string>;
};

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MOCK_CLIENTS: Array<Record<string, unknown>> = [
  {
    id: "cl_3001",
    organization_id: "org_mock",
    contact_id: "ct_9001",
    client_code: "CLI-0001",
    client_type: "individual",
    client_status: "active",
    billing_name: "Arancha Molina",
    tax_id: "12345678Z",
    profile_data: {
      intake_date: "2026-02-18",
      entry_channel: "website",
      nationality: "ES",
      budget_amount: 430000,
      typology: "Apartamento 2D",
      preferred_location: "Estepona, Casares, Manilva",
      comments: "Busca vivienda lista para entrar.",
      report_notes: null,
      visit_notes: null,
      reservation_notes: null,
      discarded_by: null,
      other_notes: null,
      agency_name: null,
      agent_name: "Elena",
      tax_id_type: "dni",
      person_kind: "fisica",
    },
    created_at: "2026-02-18T10:00:00.000Z",
    updated_at: "2026-02-18T10:00:00.000Z",
    contact: {
      id: "ct_9001",
      full_name: "Arancha Molina",
      email: "arancha@example.com",
      phone: "+34 600 100 100",
    },
    provider: null,
    agency: null,
    project_provider_ids: [],
  },
  {
    id: "cl_3002",
    organization_id: "org_mock",
    contact_id: "ct_9002",
    client_code: "CLI-0002",
    client_type: "company",
    client_status: "active",
    billing_name: "North Sea Capital BV",
    tax_id: "B99999999",
    profile_data: {
      intake_date: "2026-02-17",
      entry_channel: "agency",
      nationality: "NL",
      budget_amount: 1250000,
      typology: "Inversion obra nueva",
      preferred_location: "Fuengirola, Mijas",
      comments: "Analiza compra de varias unidades.",
      report_notes: "Enviar reporte quincenal por email.",
      visit_notes: "Visita tecnica programada para marzo.",
      reservation_notes: null,
      discarded_by: null,
      other_notes: null,
      agency_name: "Blue Coast Agency",
      agent_name: "Laura",
      tax_id_type: "cif",
      person_kind: "juridica",
    },
    created_at: "2026-02-17T10:00:00.000Z",
    updated_at: "2026-02-17T10:00:00.000Z",
    contact: {
      id: "ct_9002",
      full_name: "North Sea Capital BV",
      email: "ops@northsea-capital.com",
      phone: "+31 20 000 000",
    },
    provider: {
      id: "pr_7002",
      organization_id: "org_mock",
      client_id: "cl_3002",
      provider_code: "PRV-0002",
      provider_type: "promoter",
      provider_status: "active",
      is_billable: true,
      notes: "Proveedor principal de obra nueva.",
    },
    agency: {
      id: "ag_7002",
      organization_id: "org_mock",
      client_id: "cl_3002",
      agency_code: "AG-0002",
      agency_status: "active",
      agency_scope: "mixed",
      is_referral_source: true,
      notes: "Tambien actua como agencia internacional.",
    },
    project_provider_ids: ["11111111-1111-4111-8111-111111111111"],
  },
];

const toPositiveInt = (value: string | null, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const int = Math.floor(parsed);
  if (int < min) return min;
  if (int > max) return max;
  return int;
};

const asUuid = (value: string | null) => {
  const text = asText(value);
  if (!text) return null;
  return UUID_RX.test(text) ? text : null;
};

const normalizeClientRoleFilter = (value: string | null): ClientRoleFilter => {
  if (value === "provider") return "provider";
  if (value === "agency") return "agency";
  if (value === "provider_or_agency") return "provider_or_agency";
  if (value === "client_only") return "client_only";
  return "any";
};

const parseFilters = (url: URL): ClientFilter => {
  const clientType = url.searchParams.get("client_type");
  const clientStatus = url.searchParams.get("client_status");
  const entryChannel = url.searchParams.get("entry_channel");

  return {
    organizationId: asText(url.searchParams.get("organization_id")),
    q: String(url.searchParams.get("q") ?? "")
      .trim()
      .toLowerCase(),
    clientType: clientType === "individual" || clientType === "company" ? clientType : null,
    clientStatus:
      clientStatus === "active" ||
      clientStatus === "inactive" ||
      clientStatus === "discarded" ||
      clientStatus === "blacklisted"
        ? clientStatus
        : null,
    entryChannel:
      entryChannel === "website" ||
      entryChannel === "agency" ||
      entryChannel === "phone" ||
      entryChannel === "whatsapp" ||
      entryChannel === "email" ||
      entryChannel === "provider" ||
      entryChannel === "walkin" ||
      entryChannel === "portal" ||
      entryChannel === "other"
        ? entryChannel
        : null,
    clientRole: normalizeClientRoleFilter(asText(url.searchParams.get("client_role"))),
    projectId: asUuid(url.searchParams.get("project_id")),
    page: toPositiveInt(url.searchParams.get("page"), 1, 1, 10000),
    perPage: toPositiveInt(url.searchParams.get("per_page"), 25, 1, 200),
  };
};

const buildClientCode = () => `CLI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
const buildProviderCode = () => `PRV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
const buildAgencyCode = () => `AG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

const buildProfileFromBody = (body: CreateClientBody, clientType: ClientType) =>
  buildClientProfileData(
    {
      intake_date: asDate(body.intake_date),
      entry_channel: asText(body.entry_channel),
      agency_name: asText(body.agency_name),
      agent_name: asText(body.agent_name),
      nationality: asText(body.nationality),
      budget_amount: asNumber(body.budget_amount),
      typology: asText(body.typology),
      preferred_location: asText(body.preferred_location),
      comments: asText(body.comments),
      report_notes: asText(body.report_notes),
      visit_notes: asText(body.visit_notes),
      reservation_notes: asText(body.reservation_notes),
      discarded_by: asText(body.discarded_by),
      other_notes: asText(body.other_notes),
      tax_id_type: asText(body.tax_id_type),
      person_kind: asText(body.person_kind),
    },
    clientType
  );

const hasProviderPayload = (body: CreateClientBody) =>
  body.provider_is_billable !== undefined ||
  asText(body.provider_code) !== null ||
  asText(body.provider_type) !== null ||
  asText(body.provider_status) !== null ||
  asText(body.provider_notes) !== null;

const hasAgencyPayload = (body: CreateClientBody) =>
  body.agency_is_referral_source !== undefined ||
  asText(body.agency_code) !== null ||
  asText(body.agency_status) !== null ||
  asText(body.agency_scope) !== null ||
  asText(body.agency_notes) !== null;

const resolveRoleFlag = (explicitFlag: unknown, hasPayload: boolean) => {
  const parsed = asBoolean(explicitFlag);
  if (parsed !== null) return parsed;
  return hasPayload;
};

const applyMappedFilters = (
  rows: Array<ReturnType<typeof mapClientRow>>,
  filters: ClientFilter
) =>
  rows
    .filter((row) => (filters.organizationId ? row.organization_id === filters.organizationId : true))
    .filter((row) => (filters.clientType ? row.client_type === filters.clientType : true))
    .filter((row) => (filters.clientStatus ? row.client_status === filters.clientStatus : true))
    .filter((row) => (filters.entryChannel ? row.entry_channel === filters.entryChannel : true))
    .filter((row) => {
      if (filters.clientRole === "provider") return row.is_provider === true;
      if (filters.clientRole === "agency") return row.is_agency === true;
      if (filters.clientRole === "provider_or_agency") return row.is_provider === true || row.is_agency === true;
      if (filters.clientRole === "client_only") return row.is_provider !== true && row.is_agency !== true;
      return true;
    })
    .filter((row) => (filters.projectId ? row.is_provider_for_project === true : true))
    .filter((row) => {
      if (!filters.q) return true;
      const terms = [
        row.full_name,
        row.email,
        row.phone,
        row.client_code,
        row.tax_id,
        row.nationality,
        row.typology,
        row.preferred_location,
        row.agency_name,
        row.agent_name,
        row.provider_code,
        row.provider_type,
        row.agency_code,
        row.agency_scope,
      ]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.toLowerCase());
      return terms.some((value) => value.includes(filters.q));
    });

const fetchContactsByIds = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  organizationId: string | null,
  contactIds: string[]
) => {
  if (!client || !contactIds.length) return new Map<string, Record<string, unknown>>();

  let query = client
    .schema("crm")
    .from("contacts")
    .select(CLIENT_CONTACT_SELECT_COLUMNS)
    .in("id", contactIds);

  if (organizationId) query = query.eq("organization_id", organizationId);

  const { data, error } = await query;
  if (error) {
    throw new Error(`db_contacts_read_error:${error.message}`);
  }

  const map = new Map<string, Record<string, unknown>>();
  (data ?? []).forEach((row) => {
    const id = asText((row as Record<string, unknown>).id);
    if (!id) return;
    map.set(id, row as Record<string, unknown>);
  });
  return map;
};

const providerStatusRank = (value: unknown) =>
  normalizeProviderStatus(value) === "active" ? 0 : 1;

const agencyStatusRank = (value: unknown) => {
  const normalized = normalizeAgencyStatus(value);
  if (normalized === "active") return 0;
  if (normalized === "inactive") return 1;
  return 2;
};

const pickProviderRow = (
  current: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>
) => {
  if (!current) return incoming;
  return providerStatusRank(incoming.provider_status) < providerStatusRank(current.provider_status)
    ? incoming
    : current;
};

const pickAgencyRow = (
  current: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>
) => {
  if (!current) return incoming;
  return agencyStatusRank(incoming.agency_status) < agencyStatusRank(current.agency_status)
    ? incoming
    : current;
};

const isMissingClientProjectReservationsTableError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  const code = String(row.code ?? "");
  const message = String(row.message ?? "").toLowerCase();
  return (
    code === "PGRST205" ||
    (message.includes("client_project_reservations") && message.includes("could not find"))
  );
};

const fetchClientRelations = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  organizationId: string | null,
  clientIds: string[],
  projectId: string | null
): Promise<RelationBundle> => {
  const empty: RelationBundle = {
    providersByClientId: new Map<string, Record<string, unknown>>(),
    agenciesByClientId: new Map<string, Record<string, unknown>>(),
    projectLinkedClientIds: new Set<string>(),
  };

  if (!client || !clientIds.length) return empty;

  let providerQuery = client
    .schema("crm")
    .from("providers")
    .select(CLIENT_PROVIDER_SELECT_COLUMNS)
    .in("client_id", clientIds);
  if (organizationId) providerQuery = providerQuery.eq("organization_id", organizationId);

  const { data: providerRows, error: providerError } = await providerQuery;
  if (providerError) throw new Error(`db_providers_read_error:${providerError.message}`);

  const providersByClientId = new Map<string, Record<string, unknown>>();
  const providerIds = new Set<string>();
  (providerRows ?? []).forEach((item) => {
    const row = item as Record<string, unknown>;
    const clientId = asText(row.client_id);
    if (!clientId) return;
    providersByClientId.set(clientId, pickProviderRow(providersByClientId.get(clientId), row));
    const providerId = asText(row.id);
    if (providerId) providerIds.add(providerId);
  });

  let agencyQuery = client
    .schema("crm")
    .from("agencies")
    .select(CLIENT_AGENCY_SELECT_COLUMNS)
    .in("client_id", clientIds);
  if (organizationId) agencyQuery = agencyQuery.eq("organization_id", organizationId);

  const { data: agencyRows, error: agencyError } = await agencyQuery;
  if (agencyError) throw new Error(`db_agencies_read_error:${agencyError.message}`);

  const agenciesByClientId = new Map<string, Record<string, unknown>>();
  (agencyRows ?? []).forEach((item) => {
    const row = item as Record<string, unknown>;
    const clientId = asText(row.client_id);
    if (!clientId) return;
    agenciesByClientId.set(clientId, pickAgencyRow(agenciesByClientId.get(clientId), row));
  });

  const projectLinkedClientIds = new Set<string>();
  if (projectId && providerIds.size > 0) {
    let projectProviderQuery = client
      .schema("crm")
      .from("project_providers")
      .select("provider_id")
      .eq("project_property_id", projectId)
      .in("provider_id", Array.from(providerIds));

    if (organizationId) projectProviderQuery = projectProviderQuery.eq("organization_id", organizationId);

    const { data: linkRows, error: linkError } = await projectProviderQuery;
    if (linkError) throw new Error(`db_project_providers_read_error:${linkError.message}`);

    const linkedProviderIds = new Set<string>();
    (linkRows ?? []).forEach((row) => {
      const providerId = asText((row as Record<string, unknown>).provider_id);
      if (!providerId) return;
      linkedProviderIds.add(providerId);
    });

    providersByClientId.forEach((providerRow, clientId) => {
      const providerId = asText(providerRow.id);
      if (providerId && linkedProviderIds.has(providerId)) {
        projectLinkedClientIds.add(clientId);
      }
    });
  }

  if (projectId) {
    let reservationQuery = client
      .schema("crm")
      .from("client_project_reservations")
      .select("client_id")
      .eq("project_property_id", projectId)
      .in("client_id", clientIds);

    if (organizationId) reservationQuery = reservationQuery.eq("organization_id", organizationId);

    const { data: reservationRows, error: reservationError } = await reservationQuery;
    if (reservationError && !isMissingClientProjectReservationsTableError(reservationError)) {
      throw new Error(`db_client_project_reservations_read_error:${reservationError.message}`);
    }

    if (!reservationError) {
      (reservationRows ?? []).forEach((row) => {
        const clientId = asText((row as Record<string, unknown>).client_id);
        if (!clientId) return;
        projectLinkedClientIds.add(clientId);
      });
    }
  }

  return {
    providersByClientId,
    agenciesByClientId,
    projectLinkedClientIds,
  };
};

const buildClientsListQuery = (
  client: ReturnType<typeof getSupabaseServerClient>,
  filters: ClientFilter,
  selectColumns: string
) => {
  let query = client
    .schema("crm")
    .from("clients")
    .select(selectColumns)
    .order("updated_at", { ascending: false })
    .limit(1000);

  if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
  if (filters.clientType) query = query.eq("client_type", filters.clientType);
  if (filters.clientStatus) query = query.eq("client_status", filters.clientStatus);

  return query;
};

const insertClientRowWithProfileFallback = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  payload: Record<string, unknown>
) => {
  const firstAttempt = await client
    .schema("crm")
    .from("clients")
    .insert(payload)
    .select(CLIENT_SELECT_COLUMNS)
    .single();

  if (!firstAttempt.error) {
    return {
      data: firstAttempt.data as Record<string, unknown>,
      error: null,
      usedLegacyProfile: false,
    };
  }

  if (!isMissingProfileDataColumnError(firstAttempt.error)) {
    return { data: null, error: firstAttempt.error, usedLegacyProfile: false };
  }

  const legacyPayload = { ...payload };
  delete legacyPayload.profile_data;

  const secondAttempt = await client
    .schema("crm")
    .from("clients")
    .insert(legacyPayload)
    .select(CLIENT_SELECT_COLUMNS_LEGACY)
    .single();

  if (secondAttempt.error) {
    return { data: null, error: secondAttempt.error, usedLegacyProfile: true };
  }

  return {
    data: secondAttempt.data as Record<string, unknown>,
    error: null,
    usedLegacyProfile: true,
  };
};

export const GET: APIRoute = async ({ url }) => {
  const filters = parseFilters(url);

  if (!hasSupabaseServerClient()) {
    const mapped = MOCK_CLIENTS.map((row) => {
      const projectIds = Array.isArray((row as { project_provider_ids?: unknown }).project_provider_ids)
        ? ((row as { project_provider_ids?: string[] }).project_provider_ids ?? [])
        : [];

      return mapClientRow(
        row,
        (row as { contact?: Record<string, unknown> }).contact ?? null,
        {
          provider: (row as { provider?: Record<string, unknown> | null }).provider ?? null,
          agency: (row as { agency?: Record<string, unknown> | null }).agency ?? null,
          isProviderForProject: filters.projectId ? projectIds.includes(filters.projectId) : false,
        }
      );
    });

    const filtered = applyMappedFilters(mapped, filters);
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / filters.perPage));
    const page = Math.min(filters.page, totalPages);
    const start = (page - 1) * filters.perPage;
    const data = filtered.slice(start, start + filters.perPage);

    return jsonResponse({
      ok: true,
      data,
      meta: {
        count: data.length,
        total,
        page,
        per_page: filters.perPage,
        total_pages: totalPages,
        storage: "mock_in_memory",
        next_step: "connect_supabase_table_crm_clients",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  let { data: clientRows, error: clientsError } = await buildClientsListQuery(
    client,
    filters,
    CLIENT_SELECT_COLUMNS
  );
  let usedLegacyProfile = false;

  if (clientsError && isMissingProfileDataColumnError(clientsError)) {
    usedLegacyProfile = true;
    const legacyAttempt = await buildClientsListQuery(client, filters, CLIENT_SELECT_COLUMNS_LEGACY);
    clientRows = legacyAttempt.data;
    clientsError = legacyAttempt.error;
  }

  if (clientsError) {
    return jsonResponse(
      { ok: false, error: "db_read_error", details: clientsError.message },
      { status: 500 }
    );
  }

  const rows = (clientRows ?? []) as Array<Record<string, unknown>>;
  const contactIds = rows
    .map((row) => asText(row.contact_id))
    .filter((value): value is string => Boolean(value));
  const clientIds = rows
    .map((row) => asText(row.id))
    .filter((value): value is string => Boolean(value));

  let contactsById = new Map<string, Record<string, unknown>>();
  try {
    contactsById = await fetchContactsByIds(client, filters.organizationId, contactIds);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_contacts_read_error",
        details: error instanceof Error ? error.message : "unknown_contacts_error",
      },
      { status: 500 }
    );
  }

  let relations: RelationBundle = {
    providersByClientId: new Map<string, Record<string, unknown>>(),
    agenciesByClientId: new Map<string, Record<string, unknown>>(),
    projectLinkedClientIds: new Set<string>(),
  };

  try {
    relations = await fetchClientRelations(client, filters.organizationId, clientIds, filters.projectId);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_relations_read_error",
        details: error instanceof Error ? error.message : "unknown_relations_error",
      },
      { status: 500 }
    );
  }

  const mapped = rows.map((row) => {
    const contactId = asText(row.contact_id);
    const contact = contactId ? contactsById.get(contactId) ?? null : null;
    const clientId = asText(row.id);
    const provider = clientId ? relations.providersByClientId.get(clientId) ?? null : null;
    const agency = clientId ? relations.agenciesByClientId.get(clientId) ?? null : null;

    return mapClientRow(row, contact, {
      provider,
      agency,
      isProviderForProject: clientId ? relations.projectLinkedClientIds.has(clientId) : false,
    });
  });

  const filtered = applyMappedFilters(mapped, filters);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / filters.perPage));
  const page = Math.min(filters.page, totalPages);
  const start = (page - 1) * filters.perPage;
  const data = filtered.slice(start, start + filters.perPage);

  return jsonResponse({
    ok: true,
    data,
    meta: {
      count: data.length,
      total,
      page,
      per_page: filters.perPage,
      total_pages: totalPages,
      storage: "supabase.crm.clients",
      schema_profile_data: usedLegacyProfile ? "missing_legacy_fallback" : "available",
      filters: {
        client_role: filters.clientRole,
        project_id: filters.projectId,
      },
    },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<CreateClientBody>(request);
  if (!body) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_json_body",
      },
      { status: 400 }
    );
  }

  const organizationId = asText(body.organization_id);
  const fullName = asText(body.full_name);
  const clientType = normalizeClientType(body.client_type);
  const clientStatus = normalizeClientStatus(body.client_status);
  const profileData = buildProfileFromBody(body, clientType);
  const taxId = asText(body.tax_id);
  const email = asText(body.email);
  const phone = asText(body.phone);
  const clientCode = asText(body.client_code) ?? buildClientCode();

  const wantsProvider = resolveRoleFlag(body.as_provider, hasProviderPayload(body));
  const wantsAgency = resolveRoleFlag(body.as_agency, hasAgencyPayload(body));

  const providerCode = asText(body.provider_code) ?? (wantsProvider ? buildProviderCode() : null);
  const providerType = normalizeProviderType(body.provider_type);
  const providerStatus = normalizeProviderStatus(body.provider_status);
  const providerIsBillable = asBoolean(body.provider_is_billable) ?? true;
  const providerNotes = asText(body.provider_notes);

  const agencyCode = asText(body.agency_code) ?? (wantsAgency ? buildAgencyCode() : null);
  const agencyStatus = normalizeAgencyStatus(body.agency_status);
  const agencyScope = normalizeAgencyScope(body.agency_scope);
  const agencyIsReferralSource = asBoolean(body.agency_is_referral_source) ?? true;
  const agencyNotes = asText(body.agency_notes);

  if (!organizationId) {
    return jsonResponse(
      {
        ok: false,
        error: "organization_id_required",
      },
      { status: 422 }
    );
  }

  if (!fullName) {
    return jsonResponse(
      {
        ok: false,
        error: "full_name_required",
      },
      { status: 422 }
    );
  }

  if (!hasSupabaseServerClient()) {
    const nowIso = new Date().toISOString();
    const mockClientId = `cl_${crypto.randomUUID()}`;
    const mockContactId = `ct_${crypto.randomUUID()}`;

    const mockRow: Record<string, unknown> = {
      id: mockClientId,
      organization_id: organizationId,
      contact_id: mockContactId,
      client_code: clientCode,
      client_type: clientType,
      client_status: clientStatus,
      billing_name: fullName,
      tax_id: taxId,
      profile_data: profileData,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const contactRow: Record<string, unknown> = {
      id: mockContactId,
      organization_id: organizationId,
      full_name: fullName,
      email,
      phone,
    };

    const providerRow = wantsProvider
      ? {
          id: `pr_${crypto.randomUUID()}`,
          organization_id: organizationId,
          client_id: mockClientId,
          provider_code: providerCode,
          provider_type: providerType,
          provider_status: providerStatus,
          is_billable: providerIsBillable,
          notes: providerNotes,
        }
      : null;

    const agencyRow = wantsAgency
      ? {
          id: `ag_${crypto.randomUUID()}`,
          organization_id: organizationId,
          client_id: mockClientId,
          agency_code: agencyCode,
          agency_status: agencyStatus,
          agency_scope: agencyScope,
          is_referral_source: agencyIsReferralSource,
          notes: agencyNotes,
        }
      : null;

    return jsonResponse(
      {
        ok: true,
        data: mapClientRow(mockRow, contactRow, {
          provider: providerRow,
          agency: agencyRow,
          isProviderForProject: false,
        }),
        meta: {
          persisted: false,
          storage: "mock_in_memory",
          next_step: "insert_into_crm_clients_in_supabase",
        },
      },
      { status: 201 }
    );
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const contactType = wantsAgency ? "agency" : wantsProvider ? "vendor" : "client";

  const { data: insertedContact, error: contactError } = await client
    .schema("crm")
    .from("contacts")
    .insert({
      organization_id: organizationId,
      contact_type: contactType,
      full_name: fullName,
      email,
      phone,
      notes: profileData.comments,
    })
    .select(CLIENT_CONTACT_SELECT_COLUMNS)
    .single();

  if (contactError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_contact_insert_error",
        details: contactError.message,
      },
      { status: 500 }
    );
  }

  const contactId = asText((insertedContact as Record<string, unknown>).id);
  if (!contactId) {
    return jsonResponse(
      {
        ok: false,
        error: "contact_id_missing_after_insert",
      },
      { status: 500 }
    );
  }

  const clientInsertPayload: Record<string, unknown> = {
    organization_id: organizationId,
    contact_id: contactId,
    client_code: clientCode,
    client_type: clientType,
    client_status: clientStatus,
    billing_name: fullName,
    tax_id: taxId,
    billing_address: {},
    profile_data: profileData,
  };

  const insertedClientResult = await insertClientRowWithProfileFallback(client, clientInsertPayload);
  if (insertedClientResult.error) {
    await client.schema("crm").from("contacts").delete().eq("id", contactId);
    return jsonResponse(
      {
        ok: false,
        error: "db_insert_error",
        details: insertedClientResult.error.message,
      },
      { status: 500 }
    );
  }

  const insertedClientRow = insertedClientResult.data as Record<string, unknown>;
  const insertedClientId = asText(insertedClientRow.id);
  if (!insertedClientId) {
    await client.schema("crm").from("clients").delete().eq("id", insertedClientRow.id);
    await client.schema("crm").from("contacts").delete().eq("id", contactId);
    return jsonResponse(
      {
        ok: false,
        error: "client_id_missing_after_insert",
      },
      { status: 500 }
    );
  }

  let insertedProvider: Record<string, unknown> | null = null;
  let insertedAgency: Record<string, unknown> | null = null;

  if (wantsProvider) {
    const { data: providerData, error: providerError } = await client
      .schema("crm")
      .from("providers")
      .insert({
        organization_id: organizationId,
        client_id: insertedClientId,
        provider_code: providerCode,
        provider_type: providerType,
        provider_status: providerStatus,
        is_billable: providerIsBillable,
        notes: providerNotes,
      })
      .select(CLIENT_PROVIDER_SELECT_COLUMNS)
      .single();

    if (providerError) {
      await client.schema("crm").from("clients").delete().eq("id", insertedClientId);
      await client.schema("crm").from("contacts").delete().eq("id", contactId);
      return jsonResponse(
        {
          ok: false,
          error: "db_provider_insert_error",
          details: providerError.message,
        },
        { status: 500 }
      );
    }

    insertedProvider = (providerData as Record<string, unknown>) ?? null;
  }

  if (wantsAgency) {
    const { data: agencyData, error: agencyError } = await client
      .schema("crm")
      .from("agencies")
      .insert({
        organization_id: organizationId,
        client_id: insertedClientId,
        agency_code: agencyCode,
        agency_status: agencyStatus,
        agency_scope: agencyScope,
        is_referral_source: agencyIsReferralSource,
        notes: agencyNotes,
      })
      .select(CLIENT_AGENCY_SELECT_COLUMNS)
      .single();

    if (agencyError) {
      if (insertedProvider) {
        await client.schema("crm").from("providers").delete().eq("id", insertedProvider.id);
      }
      await client.schema("crm").from("clients").delete().eq("id", insertedClientId);
      await client.schema("crm").from("contacts").delete().eq("id", contactId);
      return jsonResponse(
        {
          ok: false,
          error: "db_agency_insert_error",
          details: agencyError.message,
        },
        { status: 500 }
      );
    }

    insertedAgency = (agencyData as Record<string, unknown>) ?? null;
  }

  return jsonResponse(
    {
      ok: true,
      data: mapClientRow(insertedClientRow, insertedContact as Record<string, unknown>, {
        provider: insertedProvider,
        agency: insertedAgency,
        isProviderForProject: false,
      }),
      meta: {
        persisted: true,
        storage: "supabase.crm.clients",
        schema_profile_data: insertedClientResult.usedLegacyProfile
          ? "missing_legacy_fallback"
          : "available",
      },
    },
    { status: 201 }
  );
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
