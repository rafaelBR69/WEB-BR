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
  getProfilePatchFromBody,
  isMissingProfileDataColumnError,
  mapClientRow,
  normalizeAgencyScope,
  normalizeAgencyStatus,
  normalizeClientStatus,
  normalizeClientType,
  normalizeProviderStatus,
  normalizeProviderType,
} from "@/utils/crmClients";

type UpdateClientBody = {
  organization_id?: string;
  client_code?: string | null;
  client_status?: ClientStatus;
  client_type?: ClientType;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
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

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

const getClientIdFromParams = (params: Record<string, string | undefined>): string | null => {
  const raw = params.id;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
};

const buildProviderCode = () => `PRV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
const buildAgencyCode = () => `AG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

const buildProfilePatch = (
  body: UpdateClientBody,
  currentProfile: Record<string, unknown>,
  currentClientType: ClientType
) => {
  const rawPatch = getProfilePatchFromBody(body as unknown as Record<string, unknown>);
  if (!rawPatch) return null;
  return buildClientProfileData(
    {
      ...currentProfile,
      ...rawPatch,
      intake_date: hasOwn(rawPatch, "intake_date") ? asDate(rawPatch.intake_date) : currentProfile.intake_date,
      budget_amount:
        hasOwn(rawPatch, "budget_amount") ? asNumber(rawPatch.budget_amount) : currentProfile.budget_amount,
      tax_id_type: hasOwn(rawPatch, "tax_id_type") ? asText(rawPatch.tax_id_type) : currentProfile.tax_id_type,
      person_kind: hasOwn(rawPatch, "person_kind") ? asText(rawPatch.person_kind) : currentProfile.person_kind,
    },
    currentClientType
  );
};

const fetchContactById = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  contactId: string,
  organizationId: string | null
) => {
  if (!client) return null;
  let query = client
    .schema("crm")
    .from("contacts")
    .select(CLIENT_CONTACT_SELECT_COLUMNS)
    .eq("id", contactId)
    .maybeSingle();
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data, error } = await query;
  if (error) throw new Error(`db_contact_read_error:${error.message}`);
  return (data as Record<string, unknown> | null) ?? null;
};

const fetchProviderByClientId = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  clientId: string,
  organizationId: string | null
) => {
  if (!client) return null;
  let query = client
    .schema("crm")
    .from("providers")
    .select(CLIENT_PROVIDER_SELECT_COLUMNS)
    .eq("client_id", clientId)
    .limit(1)
    .maybeSingle();

  if (organizationId) query = query.eq("organization_id", organizationId);

  const { data, error } = await query;
  if (error) throw new Error(`db_provider_read_error:${error.message}`);
  return (data as Record<string, unknown> | null) ?? null;
};

const fetchAgencyByClientId = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  clientId: string,
  organizationId: string | null
) => {
  if (!client) return null;
  let query = client
    .schema("crm")
    .from("agencies")
    .select(CLIENT_AGENCY_SELECT_COLUMNS)
    .eq("client_id", clientId)
    .limit(1)
    .maybeSingle();

  if (organizationId) query = query.eq("organization_id", organizationId);

  const { data, error } = await query;
  if (error) throw new Error(`db_agency_read_error:${error.message}`);
  return (data as Record<string, unknown> | null) ?? null;
};

const buildClientByIdQuery = (
  client: ReturnType<typeof getSupabaseServerClient>,
  clientId: string,
  organizationId: string | null,
  selectColumns: string
) => {
  let query = client
    .schema("crm")
    .from("clients")
    .select(selectColumns)
    .eq("id", clientId)
    .maybeSingle();
  if (organizationId) query = query.eq("organization_id", organizationId);
  return query;
};

const fetchClientRowWithProfileFallback = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  clientId: string,
  organizationId: string | null
) => {
  let { data, error } = await buildClientByIdQuery(client, clientId, organizationId, CLIENT_SELECT_COLUMNS);
  let usedLegacyProfile = false;

  if (error && isMissingProfileDataColumnError(error)) {
    usedLegacyProfile = true;
    const legacyAttempt = await buildClientByIdQuery(
      client,
      clientId,
      organizationId,
      CLIENT_SELECT_COLUMNS_LEGACY
    );
    data = legacyAttempt.data;
    error = legacyAttempt.error;
  }

  return {
    data: (data as Record<string, unknown> | null) ?? null,
    error,
    usedLegacyProfile,
  };
};

const hasProviderPatch = (body: UpdateClientBody) =>
  hasOwn(body, "as_provider") ||
  hasOwn(body, "provider_code") ||
  hasOwn(body, "provider_type") ||
  hasOwn(body, "provider_status") ||
  hasOwn(body, "provider_is_billable") ||
  hasOwn(body, "provider_notes");

const hasAgencyPatch = (body: UpdateClientBody) =>
  hasOwn(body, "as_agency") ||
  hasOwn(body, "agency_code") ||
  hasOwn(body, "agency_status") ||
  hasOwn(body, "agency_scope") ||
  hasOwn(body, "agency_is_referral_source") ||
  hasOwn(body, "agency_notes");

export const GET: APIRoute = async ({ params, url }) => {
  const id = getClientIdFromParams(params);
  if (!id) return jsonResponse({ ok: false, error: "client_id_required" }, { status: 400 });

  if (!hasSupabaseServerClient()) {
    return jsonResponse(
      {
        ok: false,
        error: "mock_client_detail_not_implemented",
        details: "Activa Supabase para detalle de cliente.",
      },
      { status: 501 }
    );
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const organizationId = asText(url.searchParams.get("organization_id"));
  const { data, error, usedLegacyProfile } = await fetchClientRowWithProfileFallback(
    client,
    id,
    organizationId
  );
  if (error) {
    return jsonResponse(
      { ok: false, error: "db_read_error", details: error.message },
      { status: 500 }
    );
  }
  if (!data) return jsonResponse({ ok: false, error: "client_not_found" }, { status: 404 });

  const row = data as Record<string, unknown>;
  const scopedOrgId = organizationId ?? asText(row.organization_id);
  const contactId = asText(row.contact_id);

  let contact: Record<string, unknown> | null = null;
  let provider: Record<string, unknown> | null = null;
  let agency: Record<string, unknown> | null = null;

  try {
    if (contactId) {
      contact = await fetchContactById(client, contactId, scopedOrgId);
    }
    provider = await fetchProviderByClientId(client, id, scopedOrgId);
    agency = await fetchAgencyByClientId(client, id, scopedOrgId);
  } catch (readError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_relation_read_error",
        details: readError instanceof Error ? readError.message : "unknown_relation_error",
      },
      { status: 500 }
    );
  }

  return jsonResponse({
    ok: true,
    data: mapClientRow(row, contact, { provider, agency, isProviderForProject: false }),
    meta: {
      storage: "supabase.crm.clients",
      schema_profile_data: usedLegacyProfile ? "missing_legacy_fallback" : "available",
    },
  });
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = getClientIdFromParams(params);
  if (!id) return jsonResponse({ ok: false, error: "client_id_required" }, { status: 400 });

  const body = await parseJsonBody<UpdateClientBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  if (!hasSupabaseServerClient()) {
    return jsonResponse(
      {
        ok: false,
        error: "mock_client_update_not_implemented",
        details: "Activa Supabase para editar cliente.",
      },
      { status: 501 }
    );
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const scopedOrgId = asText(body.organization_id);
  const currentRead = await fetchClientRowWithProfileFallback(client, id, scopedOrgId);
  const { data: current, error: currentError } = currentRead;
  let usedLegacyProfileOnRead = currentRead.usedLegacyProfile;
  if (currentError) {
    return jsonResponse(
      { ok: false, error: "db_read_error", details: currentError.message },
      { status: 500 }
    );
  }
  if (!current) return jsonResponse({ ok: false, error: "client_not_found" }, { status: 404 });

  const currentRow = current as Record<string, unknown>;
  const effectiveOrgId = scopedOrgId ?? asText(currentRow.organization_id);

  if (!effectiveOrgId) {
    return jsonResponse(
      {
        ok: false,
        error: "organization_scope_required",
      },
      { status: 422 }
    );
  }

  const currentClientType = normalizeClientType(currentRow.client_type);
  const nextClientType = hasOwn(body, "client_type")
    ? normalizeClientType(body.client_type)
    : currentClientType;
  const currentProfile =
    currentRow.profile_data && typeof currentRow.profile_data === "object"
      ? (currentRow.profile_data as Record<string, unknown>)
      : {};
  const nextProfile = buildProfilePatch(body, currentProfile, nextClientType);

  let currentProvider: Record<string, unknown> | null = null;
  let currentAgency: Record<string, unknown> | null = null;

  try {
    currentProvider = await fetchProviderByClientId(client, id, effectiveOrgId);
    currentAgency = await fetchAgencyByClientId(client, id, effectiveOrgId);
  } catch (readError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_relation_read_error",
        details: readError instanceof Error ? readError.message : "unknown_relation_error",
      },
      { status: 500 }
    );
  }

  let nextProvider = currentProvider;
  let nextAgency = currentAgency;

  const shouldPatchProvider = hasProviderPatch(body);
  if (shouldPatchProvider) {
    const asProviderFlag = hasOwn(body, "as_provider") ? asBoolean(body.as_provider) : null;

    if (asProviderFlag === false) {
      if (nextProvider?.id) {
        const { data: providerData, error: providerDisableError } = await client
          .schema("crm")
          .from("providers")
          .update({ provider_status: "inactive" })
          .eq("id", nextProvider.id)
          .select(CLIENT_PROVIDER_SELECT_COLUMNS)
          .single();

        if (providerDisableError) {
          return jsonResponse(
            {
              ok: false,
              error: "db_provider_update_error",
              details: providerDisableError.message,
            },
            { status: 500 }
          );
        }

        nextProvider = (providerData as Record<string, unknown>) ?? nextProvider;
      }
    } else {
      const providerPayload = {
        organization_id: effectiveOrgId,
        client_id: id,
        provider_code:
          hasOwn(body, "provider_code")
            ? asText(body.provider_code)
            : asText(nextProvider?.provider_code) ?? buildProviderCode(),
        provider_type: hasOwn(body, "provider_type")
          ? normalizeProviderType(body.provider_type)
          : normalizeProviderType(nextProvider?.provider_type),
        provider_status: hasOwn(body, "provider_status")
          ? normalizeProviderStatus(body.provider_status)
          : asProviderFlag === true
            ? "active"
            : normalizeProviderStatus(nextProvider?.provider_status),
        is_billable: hasOwn(body, "provider_is_billable")
          ? asBoolean(body.provider_is_billable) ?? true
          : asBoolean(nextProvider?.is_billable) ?? true,
        notes: hasOwn(body, "provider_notes") ? asText(body.provider_notes) : asText(nextProvider?.notes),
      };

      if (nextProvider?.id) {
        const { data: providerData, error: providerUpdateError } = await client
          .schema("crm")
          .from("providers")
          .update(providerPayload)
          .eq("id", nextProvider.id)
          .select(CLIENT_PROVIDER_SELECT_COLUMNS)
          .single();

        if (providerUpdateError) {
          return jsonResponse(
            {
              ok: false,
              error: "db_provider_update_error",
              details: providerUpdateError.message,
            },
            { status: 500 }
          );
        }

        nextProvider = (providerData as Record<string, unknown>) ?? nextProvider;
      } else {
        const { data: providerData, error: providerInsertError } = await client
          .schema("crm")
          .from("providers")
          .insert(providerPayload)
          .select(CLIENT_PROVIDER_SELECT_COLUMNS)
          .single();

        if (providerInsertError) {
          return jsonResponse(
            {
              ok: false,
              error: "db_provider_insert_error",
              details: providerInsertError.message,
            },
            { status: 500 }
          );
        }

        nextProvider = (providerData as Record<string, unknown>) ?? null;
      }
    }
  }

  const shouldPatchAgency = hasAgencyPatch(body);
  if (shouldPatchAgency) {
    const asAgencyFlag = hasOwn(body, "as_agency") ? asBoolean(body.as_agency) : null;

    if (asAgencyFlag === false) {
      if (nextAgency?.id) {
        const { data: agencyData, error: agencyDisableError } = await client
          .schema("crm")
          .from("agencies")
          .update({ agency_status: "discarded" })
          .eq("id", nextAgency.id)
          .select(CLIENT_AGENCY_SELECT_COLUMNS)
          .single();

        if (agencyDisableError) {
          return jsonResponse(
            {
              ok: false,
              error: "db_agency_update_error",
              details: agencyDisableError.message,
            },
            { status: 500 }
          );
        }

        nextAgency = (agencyData as Record<string, unknown>) ?? nextAgency;
      }
    } else {
      const agencyPayload = {
        organization_id: effectiveOrgId,
        client_id: id,
        agency_code:
          hasOwn(body, "agency_code")
            ? asText(body.agency_code)
            : asText(nextAgency?.agency_code) ?? buildAgencyCode(),
        agency_status: hasOwn(body, "agency_status")
          ? normalizeAgencyStatus(body.agency_status)
          : asAgencyFlag === true
            ? "active"
            : normalizeAgencyStatus(nextAgency?.agency_status),
        agency_scope: hasOwn(body, "agency_scope")
          ? normalizeAgencyScope(body.agency_scope)
          : normalizeAgencyScope(nextAgency?.agency_scope),
        is_referral_source: hasOwn(body, "agency_is_referral_source")
          ? asBoolean(body.agency_is_referral_source) ?? true
          : asBoolean(nextAgency?.is_referral_source) ?? true,
        notes: hasOwn(body, "agency_notes") ? asText(body.agency_notes) : asText(nextAgency?.notes),
      };

      if (nextAgency?.id) {
        const { data: agencyData, error: agencyUpdateError } = await client
          .schema("crm")
          .from("agencies")
          .update(agencyPayload)
          .eq("id", nextAgency.id)
          .select(CLIENT_AGENCY_SELECT_COLUMNS)
          .single();

        if (agencyUpdateError) {
          return jsonResponse(
            {
              ok: false,
              error: "db_agency_update_error",
              details: agencyUpdateError.message,
            },
            { status: 500 }
          );
        }

        nextAgency = (agencyData as Record<string, unknown>) ?? nextAgency;
      } else {
        const { data: agencyData, error: agencyInsertError } = await client
          .schema("crm")
          .from("agencies")
          .insert(agencyPayload)
          .select(CLIENT_AGENCY_SELECT_COLUMNS)
          .single();

        if (agencyInsertError) {
          return jsonResponse(
            {
              ok: false,
              error: "db_agency_insert_error",
              details: agencyInsertError.message,
            },
            { status: 500 }
          );
        }

        nextAgency = (agencyData as Record<string, unknown>) ?? null;
      }
    }
  }

  const clientPatch: Record<string, unknown> = {};
  if (hasOwn(body, "client_code")) {
    clientPatch.client_code = asText(body.client_code);
  }
  if (hasOwn(body, "client_type")) {
    clientPatch.client_type = nextClientType;
  }
  if (hasOwn(body, "client_status")) {
    clientPatch.client_status = normalizeClientStatus(body.client_status);
  }
  if (hasOwn(body, "tax_id")) {
    clientPatch.tax_id = asText(body.tax_id);
  }
  if (nextProfile && !usedLegacyProfileOnRead) {
    clientPatch.profile_data = nextProfile;
  }
  if (hasOwn(body, "full_name")) {
    clientPatch.billing_name = asText(body.full_name);
  }

  const hasActiveProvider =
    !!nextProvider && normalizeProviderStatus(nextProvider.provider_status) === "active";
  const hasActiveAgency =
    !!nextAgency && normalizeAgencyStatus(nextAgency.agency_status) !== "discarded";
  const nextContactType = hasActiveAgency ? "agency" : hasActiveProvider ? "vendor" : "client";

  const contactPatch: Record<string, unknown> = {};
  if (hasOwn(body, "full_name")) contactPatch.full_name = asText(body.full_name);
  if (hasOwn(body, "email")) contactPatch.email = asText(body.email);
  if (hasOwn(body, "phone")) contactPatch.phone = asText(body.phone);
  if (shouldPatchProvider || shouldPatchAgency) contactPatch.contact_type = nextContactType;

  const contactId = asText(currentRow.contact_id);
  if (contactId && Object.keys(contactPatch).length > 0) {
    const { error: patchContactError } = await client
      .schema("crm")
      .from("contacts")
      .update(contactPatch)
      .eq("id", contactId)
      .eq("organization_id", effectiveOrgId);
    if (patchContactError) {
      return jsonResponse(
        {
          ok: false,
          error: "db_contact_update_error",
          details: patchContactError.message,
        },
        { status: 500 }
      );
    }
  }

  let updatedRow = currentRow;
  if (Object.keys(clientPatch).length > 0) {
    const selectColumns = usedLegacyProfileOnRead
      ? CLIENT_SELECT_COLUMNS_LEGACY
      : CLIENT_SELECT_COLUMNS;

    let patchPayload = clientPatch;
    let { data: updatedData, error: patchError } = await client
      .schema("crm")
      .from("clients")
      .update(patchPayload)
      .eq("id", id)
      .eq("organization_id", effectiveOrgId)
      .select(selectColumns)
      .single();

    if (patchError && !usedLegacyProfileOnRead && isMissingProfileDataColumnError(patchError)) {
      usedLegacyProfileOnRead = true;
      patchPayload = { ...clientPatch };
      delete patchPayload.profile_data;

      const retry = await client
        .schema("crm")
        .from("clients")
        .update(patchPayload)
        .eq("id", id)
        .eq("organization_id", effectiveOrgId)
        .select(CLIENT_SELECT_COLUMNS_LEGACY)
        .single();

      updatedData = retry.data;
      patchError = retry.error;
    }

    if (patchError) {
      return jsonResponse(
        {
          ok: false,
          error: "db_update_error",
          details: patchError.message,
        },
        { status: 500 }
      );
    }
    updatedRow = updatedData as Record<string, unknown>;
  }

  let updatedContact: Record<string, unknown> | null = null;
  const updatedContactId = asText(updatedRow.contact_id);
  if (updatedContactId) {
    try {
      updatedContact = await fetchContactById(client, updatedContactId, effectiveOrgId);
    } catch (readError) {
      return jsonResponse(
        {
          ok: false,
          error: "db_contact_read_error",
          details: readError instanceof Error ? readError.message : "unknown_contact_error",
        },
        { status: 500 }
      );
    }
  }

  return jsonResponse({
    ok: true,
    data: mapClientRow(updatedRow, updatedContact, {
      provider: nextProvider,
      agency: nextAgency,
      isProviderForProject: false,
    }),
    meta: {
      storage: "supabase.crm.clients",
      persisted: true,
      schema_profile_data: usedLegacyProfileOnRead ? "missing_legacy_fallback" : "available",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
