import { getSupabaseServerClient } from "@/utils/supabaseServer";
import {
  CLIENT_AGENCY_SELECT_COLUMNS,
  CLIENT_CONTACT_SELECT_COLUMNS,
  CLIENT_SELECT_COLUMNS,
  CLIENT_SELECT_COLUMNS_LEGACY,
  asBoolean,
  asText,
  buildClientProfileData,
  isMissingProfileDataColumnError,
  normalizeAgencyScope,
  normalizeAgencyStatus,
  normalizeClientStatus,
} from "@/utils/crmClients";
import { asUuid } from "@/utils/crmPortal";

type DbClient = NonNullable<ReturnType<typeof getSupabaseServerClient>>;

export const AGENCY_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "client_id",
  "agency_code",
  "agency_status",
  "agency_scope",
  "parent_agency_id",
  "is_referral_source",
  "notes",
  "created_at",
  "updated_at",
].join(", ");

export const AGENCY_CONTACT_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "agency_id",
  "contact_id",
  "role",
  "relation_status",
  "is_primary",
  "notes",
  "created_at",
  "updated_at",
].join(", ");

export type AgencyCreateInput = {
  full_name: string | null;
  email?: string | null;
  phone?: string | null;
  agent_name?: string | null;
  client_code?: string | null;
  client_status?: string | null;
  tax_id?: string | null;
  agency_code?: string | null;
  agency_status?: string | null;
  agency_scope?: string | null;
  agency_is_referral_source?: boolean | null;
  agency_notes?: string | null;
};

export type AgencyUpdateInput = AgencyCreateInput;

export type AgencyContactCreateInput = {
  agency_id: string;
  full_name: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  is_primary?: boolean | null;
  notes?: string | null;
};

export type AgencyContactUpdateInput = {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  is_primary?: boolean | null;
  relation_status?: string | null;
  notes?: string | null;
};

type CrmRow = Record<string, unknown>;

const asObjectRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const buildAgencyCode = () => `AG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
const buildClientCode = () => `CLI-AG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

const pickPrimaryContactName = (fullName: string | null, agentName: string | null) => agentName ?? fullName;

const buildAgencyProfileData = (
  currentProfileData: Record<string, unknown>,
  input: {
    full_name: string | null;
    agent_name: string | null;
    agency_notes: string | null;
  }
) =>
  ({
    ...currentProfileData,
    ...buildClientProfileData(
      {
        ...currentProfileData,
        entry_channel: "agency",
        agency_name: input.full_name,
        agent_name: input.agent_name,
        comments:
          input.agency_notes != null
            ? input.agency_notes
            : asText(currentProfileData.comments) ?? asText(currentProfileData.other_notes),
        report_notes:
          input.agency_notes != null
            ? input.agency_notes
            : asText(currentProfileData.report_notes) ?? asText(currentProfileData.other_notes),
        other_notes:
          input.agency_notes != null
            ? input.agency_notes
            : asText(currentProfileData.other_notes) ?? asText(currentProfileData.report_notes),
        person_kind: "juridica",
      },
      "company"
    ),
  }) as Record<string, unknown>;

const readClientWithFallback = async (client: DbClient, organizationId: string, clientId: string) => {
  let { data, error } = await client
    .schema("crm")
    .from("clients")
    .select(CLIENT_SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", clientId)
    .maybeSingle();

  if (error && isMissingProfileDataColumnError(error)) {
    const legacy = await client
      .schema("crm")
      .from("clients")
      .select(CLIENT_SELECT_COLUMNS_LEGACY)
      .eq("organization_id", organizationId)
      .eq("id", clientId)
      .maybeSingle();
    data = legacy.data;
    error = legacy.error;
  }

  if (error) throw new Error(`db_client_read_error:${error.message}`);
  return (data as Record<string, unknown> | null) ?? null;
};

const readContactById = async (client: DbClient, organizationId: string, contactId: string) => {
  const { data, error } = await client
    .schema("crm")
    .from("contacts")
    .select(CLIENT_CONTACT_SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", contactId)
    .maybeSingle();
  if (error) throw new Error(`db_contact_read_error:${error.message}`);
  return (data as Record<string, unknown> | null) ?? null;
};

export const readAgencyBundle = async (client: DbClient, organizationId: string, agencyId: string) => {
  const { data: agencyRow, error: agencyError } = await client
    .schema("crm")
    .from("agencies")
    .select(AGENCY_SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", agencyId)
    .maybeSingle();
  if (agencyError) throw new Error(`db_agency_read_error:${agencyError.message}`);
  if (!agencyRow) return null;

  const clientId = asUuid((agencyRow as Record<string, unknown>).client_id);
  const clientRow = clientId ? await readClientWithFallback(client, organizationId, clientId) : null;
  const contactId = asUuid(clientRow?.contact_id);
  const contactRow = contactId ? await readContactById(client, organizationId, contactId) : null;

  return {
    agency: agencyRow as Record<string, unknown>,
    client: clientRow,
    contact: contactRow,
  };
};

export const readAgencyContactBundle = async (client: DbClient, organizationId: string, agencyContactId: string) => {
  const { data: agencyContactRow, error: agencyContactError } = await client
    .schema("crm")
    .from("agency_contacts")
    .select(AGENCY_CONTACT_SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", agencyContactId)
    .maybeSingle();
  if (agencyContactError) throw new Error(`db_agency_contact_read_error:${agencyContactError.message}`);
  if (!agencyContactRow) return null;

  const contactId = asUuid((agencyContactRow as Record<string, unknown>).contact_id);
  const agencyId = asUuid((agencyContactRow as Record<string, unknown>).agency_id);
  const contactRow = contactId ? await readContactById(client, organizationId, contactId) : null;
  const agencyBundle = agencyId ? await readAgencyBundle(client, organizationId, agencyId) : null;

  return {
    agency_contact: agencyContactRow as Record<string, unknown>,
    contact: contactRow,
    agency: agencyBundle?.agency ?? null,
    agency_client: agencyBundle?.client ?? null,
  };
};

const findAgencyByIdentity = async (
  client: DbClient,
  organizationId: string,
  email: string | null,
  phone: string | null,
  options: { excludeAgencyId?: string | null } = {}
) => {
  const contactIds = new Set<string>();

  if (email) {
    const { data, error } = await client
      .schema("crm")
      .from("contacts")
      .select("id")
      .eq("organization_id", organizationId)
      .ilike("email", email);
    if (error) throw new Error(`db_agency_duplicate_contact_email_error:${error.message}`);
    (data ?? []).forEach((row) => {
      const contactId = asUuid((row as Record<string, unknown>).id);
      if (contactId) contactIds.add(contactId);
    });
  }

  if (phone) {
    const { data, error } = await client
      .schema("crm")
      .from("contacts")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("phone", phone);
    if (error) throw new Error(`db_agency_duplicate_contact_phone_error:${error.message}`);
    (data ?? []).forEach((row) => {
      const contactId = asUuid((row as Record<string, unknown>).id);
      if (contactId) contactIds.add(contactId);
    });
  }

  if (!contactIds.size) return null;

  const { data: clientRows, error: clientsError } = await client
    .schema("crm")
    .from("clients")
    .select("id, contact_id")
    .eq("organization_id", organizationId)
    .in("contact_id", [...contactIds]);
  if (clientsError) throw new Error(`db_agency_duplicate_client_error:${clientsError.message}`);
  const clientIds = (clientRows ?? [])
    .map((row) => asUuid((row as Record<string, unknown>).id))
    .filter((value): value is string => Boolean(value));
  if (!clientIds.length) return null;

  const { data: agencyRows, error: agenciesError } = await client
    .schema("crm")
    .from("agencies")
    .select(CLIENT_AGENCY_SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .in("client_id", clientIds)
    .limit(1);
  if (agenciesError) throw new Error(`db_agency_duplicate_lookup_error:${agenciesError.message}`);
  const excludeAgencyId = asUuid(options.excludeAgencyId);
  const match =
    (agencyRows ?? []).find((row) => {
      const agencyId = asUuid((row as Record<string, unknown>).id);
      if (!agencyId) return false;
      if (excludeAgencyId && agencyId === excludeAgencyId) return false;
      return true;
    }) ?? null;
  return (match as Record<string, unknown> | null) ?? null;
};

const clearOtherPrimaryAgencyContacts = async (
  client: DbClient,
  organizationId: string,
  agencyId: string,
  keepAgencyContactId: string | null
) => {
  let query = client
    .schema("crm")
    .from("agency_contacts")
    .update({ is_primary: false })
    .eq("organization_id", organizationId)
    .eq("agency_id", agencyId);

  if (keepAgencyContactId) query = query.neq("id", keepAgencyContactId);
  const { error } = await query;
  if (error) throw new Error(`db_agency_contacts_primary_clear_error:${error.message}`);
};

const normalizeNameKey = (value: unknown) => {
  const text = asText(value);
  if (!text) return null;
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
};

const patchLeadRawPayloadAgencyContactId = (
  rawPayloadValue: unknown,
  duplicateAgencyContactId: string,
  canonicalAgencyContactId: string
) => {
  const rawPayload = asObjectRecord(rawPayloadValue);
  const nextRawPayload = { ...rawPayload };
  let changed = false;

  if (asText(nextRawPayload.agency_contact_id) === duplicateAgencyContactId) {
    nextRawPayload.agency_contact_id = canonicalAgencyContactId;
    changed = true;
  }

  const mapped = asObjectRecord(nextRawPayload.mapped);
  if (Object.keys(mapped).length > 0 || asText(mapped.agency_contact_id) === duplicateAgencyContactId) {
    const nextMapped = { ...mapped };
    if (asText(nextMapped.agency_contact_id) === duplicateAgencyContactId) {
      nextMapped.agency_contact_id = canonicalAgencyContactId;
      changed = true;
    }
    nextRawPayload.mapped = nextMapped;
  }

  return changed ? nextRawPayload : null;
};

const buildAgencyDisplayName = (
  agencyRow: Record<string, unknown> | null,
  clientRow: Record<string, unknown> | null,
  contactRow: Record<string, unknown> | null
) =>
  asText(clientRow?.billing_name) ??
  asText(asObjectRecord(clientRow?.profile_data).agency_name) ??
  asText(asObjectRecord(clientRow?.profile_data).agent_name) ??
  asText(contactRow?.full_name) ??
  asText(agencyRow?.agency_code) ??
  "Agencia";

const readRowsByColumn = async (
  client: DbClient,
  organizationId: string,
  table: string,
  select: string,
  column: string,
  value: string
) => {
  const { data, error } = await client
    .schema("crm")
    .from(table)
    .select(select)
    .eq("organization_id", organizationId)
    .eq(column, value);
  if (error) throw new Error(`db_${table}_read_error:${error.message}`);
  return (data as CrmRow[] | null) ?? [];
};

const updateRowsByColumn = async (
  client: DbClient,
  organizationId: string,
  table: string,
  column: string,
  fromValue: string,
  toValue: string
) => {
  const { error } = await client
    .schema("crm")
    .from(table)
    .update({ [column]: toValue })
    .eq("organization_id", organizationId)
    .eq(column, fromValue);
  if (error) throw new Error(`db_${table}_update_error:${error.message}`);
};

const maybeDeleteUnreferencedContact = async (client: DbClient, organizationId: string, contactId: string) => {
  const [clientRefs, leadRefs, agencyContactRefs] = await Promise.all([
    readRowsByColumn(client, organizationId, "clients", "id", "contact_id", contactId),
    readRowsByColumn(client, organizationId, "leads", "id", "contact_id", contactId),
    readRowsByColumn(client, organizationId, "agency_contacts", "id", "contact_id", contactId),
  ]);
  if (clientRefs.length || leadRefs.length || agencyContactRefs.length) return false;

  const { error } = await client
    .schema("crm")
    .from("contacts")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", contactId);
  if (error) throw new Error(`db_contact_delete_error:${error.message}`);
  return true;
};

const mergeAgencyProfileData = (
  canonicalProfileDataValue: unknown,
  duplicateProfileDataValue: unknown,
  canonicalAgencyId: string
) => {
  const canonicalProfile = asObjectRecord(canonicalProfileDataValue);
  const duplicateProfile = asObjectRecord(duplicateProfileDataValue);
  const nextProfile = { ...canonicalProfile };
  const importSourceKeys = new Set<string>();
  const primaryImportKey = asText(canonicalProfile.import_source_key) ?? asText(duplicateProfile.import_source_key);

  [
    canonicalProfile.import_source_key,
    duplicateProfile.import_source_key,
    ...(Array.isArray(canonicalProfile.import_source_keys) ? canonicalProfile.import_source_keys : []),
    ...(Array.isArray(duplicateProfile.import_source_keys) ? duplicateProfile.import_source_keys : []),
  ]
    .map((value) => asText(value))
    .filter((value): value is string => Boolean(value))
    .forEach((value) => importSourceKeys.add(value));

  if (primaryImportKey) nextProfile.import_source_key = primaryImportKey;
  if (importSourceKeys.size) nextProfile.import_source_keys = [...importSourceKeys];

  if (!asText(nextProfile.agent_name) && asText(duplicateProfile.agent_name)) {
    nextProfile.agent_name = asText(duplicateProfile.agent_name);
  }
  if (!asText(nextProfile.agency_name) && asText(duplicateProfile.agency_name)) {
    nextProfile.agency_name = asText(duplicateProfile.agency_name);
  }
  if (asText(nextProfile.linked_agency_id)) {
    nextProfile.linked_agency_id = canonicalAgencyId;
  }
  return nextProfile;
};

const insertAgencyContactRow = async (
  client: DbClient,
  payload: {
    organization_id: string;
    agency_id: string;
    contact_id: string;
    role: string;
    relation_status: string;
    is_primary: boolean;
    notes: string | null;
  }
) => {
  const { data, error } = await client
    .schema("crm")
    .from("agency_contacts")
    .insert(payload)
    .select(AGENCY_CONTACT_SELECT_COLUMNS)
    .single();
  if (error) throw new Error(`db_agency_contact_insert_error:${error.message}`);
  return (data as CrmRow | null) ?? null;
};

const findDuplicateAgencyContactInAgency = async (
  client: DbClient,
  organizationId: string,
  agencyId: string,
  input: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
  },
  options: { excludeAgencyContactId?: string | null } = {}
) => {
  const { data, error } = await client
    .schema("crm")
    .from("agency_contacts")
    .select("id, agency_id, contact_id, role, relation_status, is_primary")
    .eq("organization_id", organizationId)
    .eq("agency_id", agencyId);
  if (error) throw new Error(`db_agency_contacts_duplicate_probe_error:${error.message}`);

  const contactIds = (data ?? [])
    .map((row) => asUuid((row as Record<string, unknown>).contact_id))
    .filter((value): value is string => Boolean(value));
  if (!contactIds.length) return null;

  const { data: contactRows, error: contactsError } = await client
    .schema("crm")
    .from("contacts")
    .select("id, full_name, email, phone")
    .eq("organization_id", organizationId)
    .in("id", contactIds);
  if (contactsError) throw new Error(`db_agency_contact_duplicate_contact_probe_error:${contactsError.message}`);

  const targetEmail = asText(input.email)?.toLowerCase() ?? null;
  const targetPhone = asText(input.phone);
  const targetName = normalizeNameKey(input.full_name);
  const contactById = new Map<string, Record<string, unknown>>();
  (contactRows ?? []).forEach((row) => {
    const contactId = asUuid((row as Record<string, unknown>).id);
    if (contactId) contactById.set(contactId, row as Record<string, unknown>);
  });

  for (const row of data ?? []) {
    const agencyContact = row as Record<string, unknown>;
    const currentAgencyContactId = asUuid(agencyContact.id);
    if (options.excludeAgencyContactId && currentAgencyContactId === options.excludeAgencyContactId) continue;
    const contactId = asUuid(agencyContact.contact_id);
    if (!contactId) continue;
    const contact = contactById.get(contactId);
    if (!contact) continue;

    const sameEmail = targetEmail && asText(contact.email)?.toLowerCase() === targetEmail;
    const samePhone = targetPhone && asText(contact.phone) === targetPhone;
    const sameName = targetName && normalizeNameKey(contact.full_name) === targetName;
    if (sameEmail || samePhone || sameName) {
      return {
        agency_contact: agencyContact,
        contact,
        matched_by: sameEmail ? "email" : samePhone ? "phone" : "full_name",
      };
    }
  }

  return null;
};

const findDuplicateAgencyContactAcrossAgencies = async (
  client: DbClient,
  organizationId: string,
  input: {
    email: string | null;
    phone: string | null;
  },
  options: {
    excludeAgencyId?: string | null;
    excludeAgencyContactId?: string | null;
  } = {}
) => {
  const targetEmail = asText(input.email)?.toLowerCase() ?? null;
  const targetPhone = asText(input.phone);
  if (!targetEmail && !targetPhone) return null;

  const contactIds = new Set<string>();
  if (targetEmail) {
    const { data, error } = await client
      .schema("crm")
      .from("contacts")
      .select("id")
      .eq("organization_id", organizationId)
      .ilike("email", targetEmail);
    if (error) throw new Error(`db_agency_contact_cross_email_probe_error:${error.message}`);
    (data ?? []).forEach((row) => {
      const contactId = asUuid((row as Record<string, unknown>).id);
      if (contactId) contactIds.add(contactId);
    });
  }
  if (targetPhone) {
    const { data, error } = await client
      .schema("crm")
      .from("contacts")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("phone", targetPhone);
    if (error) throw new Error(`db_agency_contact_cross_phone_probe_error:${error.message}`);
    (data ?? []).forEach((row) => {
      const contactId = asUuid((row as Record<string, unknown>).id);
      if (contactId) contactIds.add(contactId);
    });
  }
  if (!contactIds.size) return null;

  const { data: agencyContactRows, error: agencyContactsError } = await client
    .schema("crm")
    .from("agency_contacts")
    .select(AGENCY_CONTACT_SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .in("contact_id", [...contactIds]);
  if (agencyContactsError) throw new Error(`db_agency_contact_cross_probe_error:${agencyContactsError.message}`);

  const excludeAgencyId = asUuid(options.excludeAgencyId);
  const excludeAgencyContactId = asUuid(options.excludeAgencyContactId);
  const match =
    (agencyContactRows ?? []).find((row) => {
      const agencyContact = row as Record<string, unknown>;
      const agencyId = asUuid(agencyContact.agency_id);
      const agencyContactId = asUuid(agencyContact.id);
      if (!agencyId || !agencyContactId) return false;
      if (excludeAgencyContactId && agencyContactId === excludeAgencyContactId) return false;
      if (excludeAgencyId && agencyId === excludeAgencyId) return false;
      return true;
    }) ?? null;

  if (!match) return null;
  const contact = await readContactById(client, organizationId, asUuid((match as Record<string, unknown>).contact_id) ?? "");
  return {
    agency_contact: match as Record<string, unknown>,
    contact,
    matched_by: targetEmail && asText(contact?.email)?.toLowerCase() === targetEmail ? "email" : "phone",
  };
};

const promoteReplacementPrimaryAgencyContact = async (
  client: DbClient,
  organizationId: string,
  agencyId: string
) => {
  const { data, error } = await client
    .schema("crm")
    .from("agency_contacts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("agency_id", agencyId)
    .eq("relation_status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`db_agency_contact_replacement_primary_error:${error.message}`);
  const replacementId = asUuid((data as Record<string, unknown> | null)?.id);
  if (!replacementId) return;

  const { error: updateError } = await client
    .schema("crm")
    .from("agency_contacts")
    .update({ is_primary: true })
    .eq("organization_id", organizationId)
    .eq("id", replacementId);
  if (updateError) throw new Error(`db_agency_contact_promote_primary_error:${updateError.message}`);
};

export const createAgencyBundle = async (client: DbClient, organizationId: string, input: AgencyCreateInput) => {
  const fullName = asText(input.full_name);
  const email = asText(input.email)?.toLowerCase() ?? null;
  const phone = asText(input.phone);
  const agentName = asText(input.agent_name);
  const agencyNotes = asText(input.agency_notes);
  const duplicateAgency = await findAgencyByIdentity(client, organizationId, email, phone);

  if (duplicateAgency) {
    const duplicateAgencyId = asUuid(duplicateAgency.id);
    const duplicateClientId = asUuid(duplicateAgency.client_id);
    const error = new Error("agency_duplicate_identity");
    (error as Error & { meta?: Record<string, unknown> }).meta = {
      agency_id: duplicateAgencyId,
      client_id: duplicateClientId,
    };
    throw error;
  }

  const contactInsertPayload = {
    organization_id: organizationId,
    contact_type: "agency",
    full_name: pickPrimaryContactName(fullName, agentName),
    email,
    phone,
    notes: agencyNotes,
  };

  const { data: contactRow, error: contactInsertError } = await client
    .schema("crm")
    .from("contacts")
    .insert(contactInsertPayload)
    .select(CLIENT_CONTACT_SELECT_COLUMNS)
    .single();
  if (contactInsertError || !contactRow) {
    throw new Error(`db_agency_contact_insert_error:${contactInsertError?.message ?? "insert_failed"}`);
  }

  const clientInsertPayload = {
    organization_id: organizationId,
    contact_id: asUuid((contactRow as Record<string, unknown>).id),
    client_code: asText(input.client_code) ?? buildClientCode(),
    client_type: "company",
    client_status: normalizeClientStatus(input.client_status ?? (input.agency_status === "discarded" ? "discarded" : "active")),
    billing_name: fullName,
    tax_id: asText(input.tax_id),
    profile_data: buildAgencyProfileData(
      {},
      {
        full_name: fullName,
        agent_name: agentName,
        agency_notes: agencyNotes,
      }
    ),
  };

  const { data: clientRow, error: clientInsertError } = await client
    .schema("crm")
    .from("clients")
    .insert(clientInsertPayload)
    .select(CLIENT_SELECT_COLUMNS)
    .single();
  if (clientInsertError || !clientRow) {
    throw new Error(`db_agency_client_insert_error:${clientInsertError?.message ?? "insert_failed"}`);
  }

  const agencyInsertPayload = {
    organization_id: organizationId,
    client_id: asUuid((clientRow as Record<string, unknown>).id),
    agency_code: asText(input.agency_code) ?? buildAgencyCode(),
    agency_status: normalizeAgencyStatus(input.agency_status),
    agency_scope: normalizeAgencyScope(input.agency_scope),
    is_referral_source: input.agency_is_referral_source == null ? true : Boolean(input.agency_is_referral_source),
    notes: agencyNotes,
  };

  const { data: agencyRow, error: agencyInsertError } = await client
    .schema("crm")
    .from("agencies")
    .insert(agencyInsertPayload)
    .select(AGENCY_SELECT_COLUMNS)
    .single();
  if (agencyInsertError || !agencyRow) {
    throw new Error(`db_agency_insert_error:${agencyInsertError?.message ?? "insert_failed"}`);
  }

  return {
    agency: agencyRow as Record<string, unknown>,
    client: clientRow as Record<string, unknown>,
    contact: contactRow as Record<string, unknown>,
  };
};

export const updateAgencyBundle = async (
  client: DbClient,
  organizationId: string,
  agencyId: string,
  input: AgencyUpdateInput
) => {
  const bundle = await readAgencyBundle(client, organizationId, agencyId);
  if (!bundle) return null;

  const currentProfileData = asObjectRecord(bundle.client?.profile_data);
  const fullName = Object.prototype.hasOwnProperty.call(input, "full_name")
    ? asText(input.full_name)
    : asText(bundle.client?.billing_name);
  const nextEmail = Object.prototype.hasOwnProperty.call(input, "email")
    ? asText(input.email)?.toLowerCase() ?? null
    : asText(bundle.contact?.email)?.toLowerCase() ?? null;
  const nextPhone = Object.prototype.hasOwnProperty.call(input, "phone")
    ? asText(input.phone)
    : asText(bundle.contact?.phone);
  const agentName = Object.prototype.hasOwnProperty.call(input, "agent_name")
    ? asText(input.agent_name)
    : asText(currentProfileData.agent_name);
  const agencyNotes = Object.prototype.hasOwnProperty.call(input, "agency_notes")
    ? asText(input.agency_notes)
    : asText(bundle.agency?.notes);

  const duplicateAgency = await findAgencyByIdentity(client, organizationId, nextEmail, nextPhone, {
    excludeAgencyId: agencyId,
  });
  if (duplicateAgency) {
    const error = new Error("agency_duplicate_identity");
    (error as Error & { meta?: Record<string, unknown> }).meta = {
      agency_id: asUuid(duplicateAgency.id),
      client_id: asUuid(duplicateAgency.client_id),
    };
    throw error;
  }

  const agencyPatch: Record<string, unknown> = {};
  const clientPatch: Record<string, unknown> = {};
  const contactPatch: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(input, "agency_code")) {
    agencyPatch.agency_code = asText(input.agency_code) ?? asText(bundle.agency.agency_code) ?? buildAgencyCode();
  }
  if (Object.prototype.hasOwnProperty.call(input, "agency_status")) {
    agencyPatch.agency_status = normalizeAgencyStatus(input.agency_status);
  }
  if (Object.prototype.hasOwnProperty.call(input, "agency_scope")) {
    agencyPatch.agency_scope = normalizeAgencyScope(input.agency_scope);
  }
  if (Object.prototype.hasOwnProperty.call(input, "agency_is_referral_source")) {
    agencyPatch.is_referral_source = input.agency_is_referral_source == null ? true : Boolean(input.agency_is_referral_source);
  }
  if (Object.prototype.hasOwnProperty.call(input, "agency_notes")) {
    agencyPatch.notes = agencyNotes;
  }

  if (Object.prototype.hasOwnProperty.call(input, "client_code")) {
    clientPatch.client_code = asText(input.client_code);
  }
  if (Object.prototype.hasOwnProperty.call(input, "client_status")) {
    clientPatch.client_status = normalizeClientStatus(input.client_status);
  }
  if (Object.prototype.hasOwnProperty.call(input, "tax_id")) {
    clientPatch.tax_id = asText(input.tax_id);
  }
  if (Object.prototype.hasOwnProperty.call(input, "full_name")) {
    clientPatch.billing_name = fullName;
  }
  if (
    Object.prototype.hasOwnProperty.call(input, "full_name") ||
    Object.prototype.hasOwnProperty.call(input, "agent_name") ||
    Object.prototype.hasOwnProperty.call(input, "agency_notes")
  ) {
    clientPatch.profile_data = buildAgencyProfileData(currentProfileData, {
      full_name: fullName,
      agent_name: agentName,
      agency_notes: agencyNotes,
    });
  }

  if (Object.prototype.hasOwnProperty.call(input, "full_name") || Object.prototype.hasOwnProperty.call(input, "agent_name")) {
    contactPatch.full_name = pickPrimaryContactName(fullName, agentName);
  }
  if (Object.prototype.hasOwnProperty.call(input, "email")) {
    contactPatch.email = asText(input.email)?.toLowerCase() ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "phone")) {
    contactPatch.phone = asText(input.phone);
  }

  if (Object.keys(agencyPatch).length) {
    const { error } = await client
      .schema("crm")
      .from("agencies")
      .update(agencyPatch)
      .eq("organization_id", organizationId)
      .eq("id", agencyId);
    if (error) throw new Error(`db_agency_update_error:${error.message}`);
  }

  const clientId = asUuid(bundle.client?.id);
  if (clientId && Object.keys(clientPatch).length) {
    const { error } = await client
      .schema("crm")
      .from("clients")
      .update(clientPatch)
      .eq("organization_id", organizationId)
      .eq("id", clientId);
    if (error) throw new Error(`db_agency_client_update_error:${error.message}`);
  }

  const contactId = asUuid(bundle.contact?.id);
  if (contactId && Object.keys(contactPatch).length) {
    const { error } = await client
      .schema("crm")
      .from("contacts")
      .update(contactPatch)
      .eq("organization_id", organizationId)
      .eq("id", contactId);
    if (error) throw new Error(`db_agency_base_contact_update_error:${error.message}`);
  }

  return await readAgencyBundle(client, organizationId, agencyId);
};

export const archiveAgencyBundle = async (client: DbClient, organizationId: string, agencyId: string) => {
  const bundle = await readAgencyBundle(client, organizationId, agencyId);
  if (!bundle) return null;

  const clientId = asUuid(bundle.client?.id);
  const { error: agencyError } = await client
    .schema("crm")
    .from("agencies")
    .update({ agency_status: "discarded" })
    .eq("organization_id", organizationId)
    .eq("id", agencyId);
  if (agencyError) throw new Error(`db_agency_archive_error:${agencyError.message}`);

  if (clientId) {
    const { error: clientError } = await client
      .schema("crm")
      .from("clients")
      .update({ client_status: "discarded" })
      .eq("organization_id", organizationId)
      .eq("id", clientId);
    if (clientError) throw new Error(`db_agency_client_archive_error:${clientError.message}`);
  }

  return await readAgencyBundle(client, organizationId, agencyId);
};

export const createAgencyContactBundle = async (
  client: DbClient,
  organizationId: string,
  input: AgencyContactCreateInput
) => {
  const agencyBundle = await readAgencyBundle(client, organizationId, input.agency_id);
  if (!agencyBundle) return null;

  const fullName = asText(input.full_name);
  const email = asText(input.email)?.toLowerCase() ?? null;
  const phone = asText(input.phone);
  const role = asText(input.role) ?? "agent";
  const isPrimary = input.is_primary === true;
  const notes = asText(input.notes);

  const duplicateAgency = await findAgencyByIdentity(client, organizationId, email, phone);
  const duplicateAgencyId = asUuid(duplicateAgency?.id);
  if (duplicateAgencyId && duplicateAgencyId !== input.agency_id) {
    const error = new Error("agency_contact_identity_in_other_agency");
    (error as Error & { meta?: Record<string, unknown> }).meta = { agency_id: duplicateAgencyId };
    throw error;
  }

  const duplicateAcrossAgency = await findDuplicateAgencyContactAcrossAgencies(
    client,
    organizationId,
    {
      email,
      phone,
    },
    {
      excludeAgencyId: input.agency_id,
      excludeAgencyContactId: null,
    }
  );
  if (duplicateAcrossAgency) {
    const error = new Error("agency_contact_identity_in_other_agency");
    (error as Error & { meta?: Record<string, unknown> }).meta = {
      agency_id: asUuid(duplicateAcrossAgency.agency_contact.agency_id),
      agency_contact_id: asUuid(duplicateAcrossAgency.agency_contact.id),
      contact_id: asUuid(duplicateAcrossAgency.contact?.id),
      matched_by: duplicateAcrossAgency.matched_by,
    };
    throw error;
  }

  const duplicateInAgency = await findDuplicateAgencyContactInAgency(client, organizationId, input.agency_id, {
    full_name: fullName,
    email,
    phone,
  });
  if (duplicateInAgency) {
    const error = new Error("agency_contact_duplicate_in_agency");
    (error as Error & { meta?: Record<string, unknown> }).meta = {
      agency_contact_id: asUuid(duplicateInAgency.agency_contact.id),
      contact_id: asUuid(duplicateInAgency.contact.id),
      matched_by: duplicateInAgency.matched_by,
    };
    throw error;
  }

  const contactInsertPayload = {
    organization_id: organizationId,
    contact_type: "agency",
    full_name,
    email,
    phone,
    notes,
  };

  const { data: contactRow, error: contactInsertError } = await client
    .schema("crm")
    .from("contacts")
    .insert(contactInsertPayload)
    .select(CLIENT_CONTACT_SELECT_COLUMNS)
    .single();
  if (contactInsertError || !contactRow) {
    throw new Error(`db_agency_contact_contact_insert_error:${contactInsertError?.message ?? "insert_failed"}`);
  }

  const agencyContactInsertPayload = {
    organization_id: organizationId,
    agency_id: input.agency_id,
    contact_id: asUuid((contactRow as Record<string, unknown>).id),
    role,
    relation_status: "active",
    is_primary: isPrimary,
    notes,
  };

  const { data: agencyContactRow, error: agencyContactInsertError } = await client
    .schema("crm")
    .from("agency_contacts")
    .insert(agencyContactInsertPayload)
    .select(AGENCY_CONTACT_SELECT_COLUMNS)
    .single();
  if (agencyContactInsertError || !agencyContactRow) {
    throw new Error(`db_agency_contact_insert_error:${agencyContactInsertError?.message ?? "insert_failed"}`);
  }

  if (isPrimary) {
    await clearOtherPrimaryAgencyContacts(
      client,
      organizationId,
      input.agency_id,
      asUuid((agencyContactRow as Record<string, unknown>).id)
    );
  }

  return {
    agency_contact: agencyContactRow as Record<string, unknown>,
    contact: contactRow as Record<string, unknown>,
    agency: agencyBundle.agency,
  };
};

export const updateAgencyContactBundle = async (
  client: DbClient,
  organizationId: string,
  agencyContactId: string,
  input: AgencyContactUpdateInput
) => {
  const bundle = await readAgencyContactBundle(client, organizationId, agencyContactId);
  if (!bundle) return null;

  const agencyId = asUuid(bundle.agency?.id);
  const nextFullName = Object.prototype.hasOwnProperty.call(input, "full_name")
    ? asText(input.full_name)
    : asText(bundle.contact?.full_name);
  const nextEmail = Object.prototype.hasOwnProperty.call(input, "email")
    ? asText(input.email)?.toLowerCase() ?? null
    : asText(bundle.contact?.email)?.toLowerCase() ?? null;
  const nextPhone = Object.prototype.hasOwnProperty.call(input, "phone")
    ? asText(input.phone)
    : asText(bundle.contact?.phone);

  if (agencyId) {
    const duplicateInAgency = await findDuplicateAgencyContactInAgency(
      client,
      organizationId,
      agencyId,
      {
        full_name: nextFullName,
        email: nextEmail,
        phone: nextPhone,
      },
      { excludeAgencyContactId: agencyContactId }
    );
    if (duplicateInAgency) {
      const error = new Error("agency_contact_duplicate_in_agency");
      (error as Error & { meta?: Record<string, unknown> }).meta = {
        agency_contact_id: asUuid(duplicateInAgency.agency_contact.id),
        contact_id: asUuid(duplicateInAgency.contact.id),
        matched_by: duplicateInAgency.matched_by,
      };
      throw error;
    }
  }

  const duplicateAcrossAgency = await findDuplicateAgencyContactAcrossAgencies(
    client,
    organizationId,
    {
      email: nextEmail,
      phone: nextPhone,
    },
    {
      excludeAgencyId: agencyId,
      excludeAgencyContactId: agencyContactId,
    }
  );
  if (duplicateAcrossAgency) {
    const error = new Error("agency_contact_identity_in_other_agency");
    (error as Error & { meta?: Record<string, unknown> }).meta = {
      agency_id: asUuid(duplicateAcrossAgency.agency_contact.agency_id),
      agency_contact_id: asUuid(duplicateAcrossAgency.agency_contact.id),
      contact_id: asUuid(duplicateAcrossAgency.contact?.id),
      matched_by: duplicateAcrossAgency.matched_by,
    };
    throw error;
  }

  const agencyContactPatch: Record<string, unknown> = {};
  const contactPatch: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(input, "role")) {
    agencyContactPatch.role = asText(input.role) ?? "agent";
  }
  if (Object.prototype.hasOwnProperty.call(input, "relation_status")) {
    agencyContactPatch.relation_status = asText(input.relation_status) ?? "active";
  }
  if (Object.prototype.hasOwnProperty.call(input, "is_primary")) {
    agencyContactPatch.is_primary = input.is_primary === true;
  }
  if (Object.prototype.hasOwnProperty.call(input, "notes")) {
    agencyContactPatch.notes = asText(input.notes);
  }

  if (Object.prototype.hasOwnProperty.call(input, "full_name")) {
    contactPatch.full_name = asText(input.full_name);
  }
  if (Object.prototype.hasOwnProperty.call(input, "email")) {
    contactPatch.email = asText(input.email)?.toLowerCase() ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "phone")) {
    contactPatch.phone = asText(input.phone);
  }

  if (Object.keys(agencyContactPatch).length) {
    const { error } = await client
      .schema("crm")
      .from("agency_contacts")
      .update(agencyContactPatch)
      .eq("organization_id", organizationId)
      .eq("id", agencyContactId);
    if (error) throw new Error(`db_agency_contact_update_error:${error.message}`);
  }

  const contactId = asUuid(bundle.contact?.id);
  if (contactId && Object.keys(contactPatch).length) {
    const { error } = await client
      .schema("crm")
      .from("contacts")
      .update(contactPatch)
      .eq("organization_id", organizationId)
      .eq("id", contactId);
    if (error) throw new Error(`db_agency_contact_person_update_error:${error.message}`);
  }

  const isPrimary = agencyContactPatch.is_primary === true;
  if (agencyId && isPrimary) {
    await clearOtherPrimaryAgencyContacts(client, organizationId, agencyId, agencyContactId);
  }

  return await readAgencyContactBundle(client, organizationId, agencyContactId);
};

export const deactivateAgencyContactBundle = async (
  client: DbClient,
  organizationId: string,
  agencyContactId: string
) => {
  const bundle = await readAgencyContactBundle(client, organizationId, agencyContactId);
  if (!bundle) return null;

  const agencyId = asUuid(bundle.agency?.id);
  const wasPrimary = bundle.agency_contact.is_primary === true;

  const { error } = await client
    .schema("crm")
    .from("agency_contacts")
    .update({
      relation_status: "inactive",
      is_primary: false,
    })
    .eq("organization_id", organizationId)
    .eq("id", agencyContactId);
  if (error) throw new Error(`db_agency_contact_deactivate_error:${error.message}`);

  if (agencyId && wasPrimary) {
    await promoteReplacementPrimaryAgencyContact(client, organizationId, agencyId);
  }

  return await readAgencyContactBundle(client, organizationId, agencyContactId);
};

export const mergeAgencyContactBundle = async (
  client: DbClient,
  organizationId: string,
  canonicalAgencyContactId: string,
  duplicateAgencyContactId: string
) => {
  if (canonicalAgencyContactId === duplicateAgencyContactId) {
    throw new Error("agency_contact_merge_same_id");
  }

  const canonicalBundle = await readAgencyContactBundle(client, organizationId, canonicalAgencyContactId);
  const duplicateBundle = await readAgencyContactBundle(client, organizationId, duplicateAgencyContactId);
  if (!canonicalBundle || !duplicateBundle) return null;

  const canonicalAgencyId = asUuid(canonicalBundle.agency?.id);
  const duplicateAgencyId = asUuid(duplicateBundle.agency?.id);
  const canonicalContactId = asUuid(canonicalBundle.contact?.id);
  const duplicateContactId = asUuid(duplicateBundle.contact?.id);
  if (!canonicalAgencyId || !duplicateAgencyId || !canonicalContactId || !duplicateContactId) {
    throw new Error("agency_contact_merge_invalid_bundle");
  }
  if (canonicalAgencyId !== duplicateAgencyId) {
    throw new Error("agency_contact_merge_different_agencies");
  }

  const canonicalAgencyName = buildAgencyDisplayName(
    canonicalBundle.agency,
    canonicalBundle.agency_client,
    canonicalBundle.contact
  );
  const canonicalContactPatch: Record<string, unknown> = {};
  if (
    (!asText(canonicalBundle.contact?.full_name) ||
      isGenericContactName(canonicalBundle.contact?.full_name, canonicalAgencyName)) &&
    asText(duplicateBundle.contact?.full_name) &&
    !isGenericContactName(duplicateBundle.contact?.full_name, canonicalAgencyName)
  ) {
    canonicalContactPatch.full_name = asText(duplicateBundle.contact?.full_name);
  }
  if (!asText(canonicalBundle.contact?.email) && asText(duplicateBundle.contact?.email)) {
    canonicalContactPatch.email = asText(duplicateBundle.contact?.email)?.toLowerCase() ?? null;
  }
  if (!asText(canonicalBundle.contact?.phone) && asText(duplicateBundle.contact?.phone)) {
    canonicalContactPatch.phone = asText(duplicateBundle.contact?.phone);
  }
  if (Object.keys(canonicalContactPatch).length) {
    const { error } = await client
      .schema("crm")
      .from("contacts")
      .update(canonicalContactPatch)
      .eq("organization_id", organizationId)
      .eq("id", canonicalContactId);
    if (error) throw new Error(`db_agency_contact_merge_person_update_error:${error.message}`);
  }

  const canonicalAgencyContactPatch: Record<string, unknown> = {};
  if (canonicalBundle.agency_contact.relation_status !== "active" && duplicateBundle.agency_contact.relation_status === "active") {
    canonicalAgencyContactPatch.relation_status = "active";
  }
  if (canonicalBundle.agency_contact.is_primary !== true && duplicateBundle.agency_contact.is_primary === true) {
    canonicalAgencyContactPatch.is_primary = true;
  }
  if (!asText(canonicalBundle.agency_contact.notes) && asText(duplicateBundle.agency_contact.notes)) {
    canonicalAgencyContactPatch.notes = asText(duplicateBundle.agency_contact.notes);
  }
  if (Object.keys(canonicalAgencyContactPatch).length) {
    const { error } = await client
      .schema("crm")
      .from("agency_contacts")
      .update(canonicalAgencyContactPatch)
      .eq("organization_id", organizationId)
      .eq("id", canonicalAgencyContactId);
    if (error) throw new Error(`db_agency_contact_merge_update_error:${error.message}`);
  }

  await updateRowsByColumn(client, organizationId, "clients", "contact_id", duplicateContactId, canonicalContactId);
  await updateRowsByColumn(client, organizationId, "leads", "contact_id", duplicateContactId, canonicalContactId);

  const duplicatePayloadLeads = await readRowsByColumn(client, organizationId, "leads", "id, raw_payload", "organization_id", organizationId);
  for (const leadRow of duplicatePayloadLeads) {
    const nextRawPayload = patchLeadRawPayloadAgencyContactId(
      leadRow.raw_payload,
      duplicateAgencyContactId,
      canonicalAgencyContactId
    );
    if (!nextRawPayload) continue;
    const { error } = await client
      .schema("crm")
      .from("leads")
      .update({ raw_payload: nextRawPayload })
      .eq("organization_id", organizationId)
      .eq("id", asUuid(leadRow.id) ?? "");
    if (error) throw new Error(`db_leads_merge_raw_payload_error:${error.message}`);
  }

  const { error: agencyContactDeleteError } = await client
    .schema("crm")
    .from("agency_contacts")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", duplicateAgencyContactId);
  if (agencyContactDeleteError) throw new Error(`db_agency_contact_merge_delete_error:${agencyContactDeleteError.message}`);

  if (duplicateBundle.agency_contact.is_primary === true || canonicalAgencyContactPatch.is_primary === true) {
    await clearOtherPrimaryAgencyContacts(client, organizationId, canonicalAgencyId, canonicalAgencyContactId);
  }

  const duplicateContactDeleted = await maybeDeleteUnreferencedContact(client, organizationId, duplicateContactId);
  const merged = await readAgencyContactBundle(client, organizationId, canonicalAgencyContactId);
  return {
    merged,
    duplicate_contact_deleted: duplicateContactDeleted,
    duplicate_agency_contact_id: duplicateAgencyContactId,
    canonical_agency_contact_id: canonicalAgencyContactId,
  };
};

export const mergeAgencyBundle = async (
  client: DbClient,
  organizationId: string,
  canonicalAgencyId: string,
  duplicateAgencyId: string
) => {
  if (canonicalAgencyId === duplicateAgencyId) throw new Error("agency_merge_same_id");

  const canonicalBundle = await readAgencyBundle(client, organizationId, canonicalAgencyId);
  const duplicateBundle = await readAgencyBundle(client, organizationId, duplicateAgencyId);
  if (!canonicalBundle || !duplicateBundle) return null;

  const canonicalClientId = asUuid(canonicalBundle.client?.id);
  const duplicateClientId = asUuid(duplicateBundle.client?.id);
  const canonicalContactId = asUuid(canonicalBundle.contact?.id);
  const duplicateContactId = asUuid(duplicateBundle.contact?.id);
  if (!canonicalClientId || !duplicateClientId) throw new Error("agency_merge_invalid_bundle");

  const canonicalProfile = mergeAgencyProfileData(
    canonicalBundle.client?.profile_data,
    duplicateBundle.client?.profile_data,
    canonicalAgencyId
  );
  const canonicalClientPatch: Record<string, unknown> = {};
  if (JSON.stringify(canonicalProfile) !== JSON.stringify(asObjectRecord(canonicalBundle.client?.profile_data))) {
    canonicalClientPatch.profile_data = canonicalProfile;
  }
  if (!asText(canonicalBundle.client?.billing_name) && asText(duplicateBundle.client?.billing_name)) {
    canonicalClientPatch.billing_name = asText(duplicateBundle.client?.billing_name);
  }
  if (!asText(canonicalBundle.client?.tax_id) && asText(duplicateBundle.client?.tax_id)) {
    canonicalClientPatch.tax_id = asText(duplicateBundle.client?.tax_id);
  }
  if (Object.keys(canonicalClientPatch).length) {
    const { error } = await client
      .schema("crm")
      .from("clients")
      .update(canonicalClientPatch)
      .eq("organization_id", organizationId)
      .eq("id", canonicalClientId);
    if (error) throw new Error(`db_agency_merge_client_update_error:${error.message}`);
  }

  const referenceUpdates = [
    { table: "leads", column: "agency_id", from: duplicateAgencyId, to: canonicalAgencyId },
    { table: "leads", column: "converted_agency_id", from: duplicateAgencyId, to: canonicalAgencyId },
    { table: "portal_accounts", column: "agency_id", from: duplicateAgencyId, to: canonicalAgencyId },
    { table: "agencies", column: "parent_agency_id", from: duplicateAgencyId, to: canonicalAgencyId },
    { table: "deals", column: "client_id", from: duplicateClientId, to: canonicalClientId },
    { table: "activities", column: "client_id", from: duplicateClientId, to: canonicalClientId },
    { table: "contracts", column: "client_id", from: duplicateClientId, to: canonicalClientId },
    { table: "invoices", column: "client_id", from: duplicateClientId, to: canonicalClientId },
    { table: "documents", column: "client_id", from: duplicateClientId, to: canonicalClientId },
    { table: "portal_accounts", column: "client_id", from: duplicateClientId, to: canonicalClientId },
    { table: "providers", column: "client_id", from: duplicateClientId, to: canonicalClientId },
  ];
  for (const config of referenceUpdates) {
    await updateRowsByColumn(client, organizationId, config.table, config.column, config.from, config.to);
  }

  const canonicalReservations = await readRowsByColumn(
    client,
    organizationId,
    "client_project_reservations",
    "id, client_id, project_property_id, source_file, source_row_number",
    "client_id",
    canonicalClientId
  );
  const duplicateReservations = await readRowsByColumn(
    client,
    organizationId,
    "client_project_reservations",
    "id, client_id, project_property_id, source_file, source_row_number",
    "client_id",
    duplicateClientId
  );
  const reservationKeys = new Set(
    canonicalReservations.map(
      (row) => `${asText(row.project_property_id) ?? ""}|${asText(row.source_file) ?? ""}|${asText(row.source_row_number) ?? ""}`
    )
  );
  for (const reservationRow of duplicateReservations) {
    const reservationId = asUuid(reservationRow.id);
    if (!reservationId) continue;
    const reservationKey = `${asText(reservationRow.project_property_id) ?? ""}|${asText(reservationRow.source_file) ?? ""}|${asText(reservationRow.source_row_number) ?? ""}`;
    if (reservationKeys.has(reservationKey)) {
      const { error } = await client
        .schema("crm")
        .from("client_project_reservations")
        .delete()
        .eq("organization_id", organizationId)
        .eq("id", reservationId);
      if (error) throw new Error(`db_agency_merge_reservation_delete_error:${error.message}`);
      continue;
    }
    reservationKeys.add(reservationKey);
    const { error } = await client
      .schema("crm")
      .from("client_project_reservations")
      .update({ client_id: canonicalClientId })
      .eq("organization_id", organizationId)
      .eq("id", reservationId);
    if (error) throw new Error(`db_agency_merge_reservation_update_error:${error.message}`);
  }

  const canonicalPropertyLinks = await readRowsByColumn(
    client,
    organizationId,
    "property_client_links",
    "id, client_id, property_id",
    "client_id",
    canonicalClientId
  );
  const duplicatePropertyLinks = await readRowsByColumn(
    client,
    organizationId,
    "property_client_links",
    "id, client_id, property_id",
    "client_id",
    duplicateClientId
  );
  const propertyKeys = new Set(canonicalPropertyLinks.map((row) => asText(row.property_id) ?? ""));
  for (const linkRow of duplicatePropertyLinks) {
    const linkId = asUuid(linkRow.id);
    const propertyId = asText(linkRow.property_id);
    if (!linkId || !propertyId) continue;
    if (propertyKeys.has(propertyId)) {
      const { error } = await client
        .schema("crm")
        .from("property_client_links")
        .delete()
        .eq("organization_id", organizationId)
        .eq("id", linkId);
      if (error) throw new Error(`db_agency_merge_property_link_delete_error:${error.message}`);
      continue;
    }
    propertyKeys.add(propertyId);
    const { error } = await client
      .schema("crm")
      .from("property_client_links")
      .update({ client_id: canonicalClientId })
      .eq("organization_id", organizationId)
      .eq("id", linkId);
    if (error) throw new Error(`db_agency_merge_property_link_update_error:${error.message}`);
  }

  const clientRows = await readRowsByColumn(client, organizationId, "clients", "id, profile_data", "organization_id", organizationId);
  for (const clientRow of clientRows) {
    const profileData = asObjectRecord(clientRow.profile_data);
    if (asText(profileData.linked_agency_id) !== duplicateAgencyId) continue;
    const nextProfile = {
      ...profileData,
      linked_agency_id: canonicalAgencyId,
    };
    if (!asText(nextProfile.linked_agency_name)) {
      nextProfile.linked_agency_name = buildAgencyDisplayName(
        canonicalBundle.agency,
        canonicalBundle.client,
        canonicalBundle.contact
      );
    }
    const { error } = await client
      .schema("crm")
      .from("clients")
      .update({ profile_data: nextProfile })
      .eq("organization_id", organizationId)
      .eq("id", asUuid(clientRow.id) ?? "");
    if (error) throw new Error(`db_client_linked_agency_merge_error:${error.message}`);
  }

  const canonicalAgencyContacts = await readRowsByColumn(
    client,
    organizationId,
    "agency_contacts",
    AGENCY_CONTACT_SELECT_COLUMNS,
    "agency_id",
    canonicalAgencyId
  );
  const canonicalContactKeys = new Set(
    canonicalAgencyContacts.map((row) => `${asUuid(row.contact_id) ?? ""}|${asText(row.role) ?? "agent"}`)
  );
  const duplicateAgencyContacts = await readRowsByColumn(
    client,
    organizationId,
    "agency_contacts",
    AGENCY_CONTACT_SELECT_COLUMNS,
    "agency_id",
    duplicateAgencyId
  );

  if (duplicateContactId && duplicateContactId !== canonicalContactId) {
    const baseKey = `${duplicateContactId}|agent`;
    if (!canonicalContactKeys.has(baseKey)) {
      await insertAgencyContactRow(client, {
        organization_id: organizationId,
        agency_id: canonicalAgencyId,
        contact_id: duplicateContactId,
        role: "agent",
        relation_status: "active",
        is_primary: false,
        notes: `Merged from agency ${buildAgencyDisplayName(duplicateBundle.agency, duplicateBundle.client, duplicateBundle.contact)}`,
      });
      canonicalContactKeys.add(baseKey);
    }
  }

  for (const agencyContactRow of duplicateAgencyContacts) {
    const agencyContactId = asUuid(agencyContactRow.id);
    const contactId = asUuid(agencyContactRow.contact_id);
    if (!agencyContactId || !contactId) continue;
    const key = `${contactId}|${asText(agencyContactRow.role) ?? "agent"}`;
    if (canonicalContactKeys.has(key)) {
      const { error } = await client
        .schema("crm")
        .from("agency_contacts")
        .delete()
        .eq("organization_id", organizationId)
        .eq("id", agencyContactId);
      if (error) throw new Error(`db_agency_merge_contact_delete_error:${error.message}`);
      continue;
    }
    canonicalContactKeys.add(key);
    const { error } = await client
      .schema("crm")
      .from("agency_contacts")
      .update({ agency_id: canonicalAgencyId })
      .eq("organization_id", organizationId)
      .eq("id", agencyContactId);
    if (error) throw new Error(`db_agency_merge_contact_move_error:${error.message}`);
  }

  const { error: duplicateAgencyDeleteError } = await client
    .schema("crm")
    .from("agencies")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", duplicateAgencyId);
  if (duplicateAgencyDeleteError) throw new Error(`db_agency_merge_delete_error:${duplicateAgencyDeleteError.message}`);

  const { error: duplicateClientDeleteError } = await client
    .schema("crm")
    .from("clients")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", duplicateClientId);
  if (duplicateClientDeleteError) throw new Error(`db_agency_merge_client_delete_error:${duplicateClientDeleteError.message}`);

  if (duplicateContactId && duplicateContactId !== canonicalContactId) {
    await maybeDeleteUnreferencedContact(client, organizationId, duplicateContactId);
  }

  const merged = await readAgencyBundle(client, organizationId, canonicalAgencyId);
  return {
    merged,
    canonical_agency_id: canonicalAgencyId,
    duplicate_agency_id: duplicateAgencyId,
  };
};
