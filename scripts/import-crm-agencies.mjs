import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  ROOT,
  arg,
  ensureDir,
  parseEnvFile,
  readJson,
  relativeFromRoot,
  timestamp,
  txt,
  canonical,
  mergeUniqueText,
  writeCsv,
  writeJson,
} from "./agency-import/shared.mjs";

const DEFAULT_INPUT_JSON = path.join(ROOT, "scripts", "agency-import", "reference", "agency-staging-deduped-latest.json");
const REFERENCE_DIR = path.join(ROOT, "scripts", "agency-import", "reference");
const REPORTS_DIR = path.join(ROOT, "scripts", "agency-import", "reports");

const envFileValues = {
  ...parseEnvFile(path.join(ROOT, ".env")),
  ...parseEnvFile(path.join(ROOT, ".env.local")),
};

const env = (name) => {
  const value = process.env[name] ?? envFileValues[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const flag = (name) => process.argv.includes(`--${name}`);

const normalizeName = (value) => canonical(value).replace(/\s+/g, " ").trim() || null;
const normalizeBrand = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.]+/g, " ")
    .trim() || null;
const emailDomain = (value) => {
  const email = txt(value)?.toLowerCase();
  if (!email || !email.includes("@")) return null;
  return email.split("@").pop() ?? null;
};
const resolveCliPath = (value, fallback) => {
  const selected = value ?? fallback;
  return path.isAbsolute(selected) ? selected : path.join(ROOT, selected);
};
const INPUT_JSON = resolveCliPath(arg("input-json"), DEFAULT_INPUT_JSON);
const APPLY = flag("apply");
const LIMIT = Number(arg("limit") ?? 0) || null;
const UPDATE_EXISTING = !flag("no-update-existing");
const ORGANIZATION_ID = txt(arg("organization-id")) ?? env("CRM_ORGANIZATION_ID");
const SUPABASE_URL = env("SUPABASE_URL") ?? env("PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

if (!ORGANIZATION_ID) throw new Error("organization_id_required");
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("supabase_credentials_required");
if (!fs.existsSync(INPUT_JSON)) throw new Error(`input_json_not_found:${INPUT_JSON}`);

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const PAGE_SIZE = 1000;

const CONTACT_SELECT = "id, organization_id, contact_type, full_name, email, phone, notes, updated_at, created_at";
const CLIENT_SELECT =
  "id, organization_id, contact_id, client_code, client_type, client_status, billing_name, tax_id, profile_data, updated_at, created_at";
const AGENCY_SELECT =
  "id, organization_id, client_id, agency_code, agency_status, agency_scope, is_referral_source, notes, updated_at, created_at";
const AGENCY_CONTACT_SELECT =
  "id, organization_id, agency_id, contact_id, role, relation_status, is_primary, notes, updated_at, created_at";

const buildAgencyStatus = (row) => {
  const stage = txt(row.relationship_stage);
  if (stage === "discarded") return "discarded";
  if (stage === "pending") return "inactive";
  return "active";
};

const buildBaseContactName = (row) =>
  txt(row.legal_name) ??
  txt(row.agency_name) ??
  txt(row.agent_name) ??
  txt(row.email) ??
  txt(row.phone) ??
  `Agency ${txt(row.project_label) ?? ""}`.trim();

const isImportableAgencyRow = (row) =>
  Boolean(
    txt(row.tax_id) ??
      txt(row.legal_name) ??
      txt(row.agency_name) ??
      txt(row.agent_name) ??
      txt(row.email)
  );

const buildAgencyNotes = (row) =>
  mergeUniqueText(
    `Proyecto: ${txt(row.project_label) ?? "-"}`,
    `Legacy: ${txt(row.project_legacy_code) ?? "-"}`,
    `Dedupe: ${txt(row.dedupe_key) ?? "-"}`,
    row.commercial_comment,
    row.legal_comment,
    row.resent_to_agency
  );

const shouldSkipBrandMatch = (row) => row?.skip_brand_match === true || txt(row?.skip_brand_match) === "true";

const buildAgencyDisplayName = ({ agency, client, baseContact }) =>
  txt(client?.billing_name) ??
  txt(client?.profile_data?.agency_name) ??
  txt(baseContact?.full_name) ??
  txt(client?.profile_data?.agent_name) ??
  txt(client?.client_code) ??
  txt(agency?.agency_code) ??
  "Agencia";

const buildProfileData = (row) => ({
  intake_date: txt(row.intake_date),
  entry_channel: "agency",
  agency_name: txt(row.agency_name),
  agent_name: txt(row.agent_name),
  nationality: txt(row.country),
  budget_amount: null,
  typology: null,
  preferred_location: txt(row.project_label),
  comments: txt(row.combined_comments),
  report_notes: buildAgencyNotes(row),
  visit_notes: null,
  reservation_notes: null,
  discarded_by: null,
  other_notes: buildAgencyNotes(row),
  tax_id_type: txt(row.tax_id) ? "cif" : null,
  person_kind: "juridica",
  import_source_key: txt(row.dedupe_key),
  import_source_keys: txt(row.dedupe_key) ? [txt(row.dedupe_key)] : [],
  import_project_legacy_code: txt(row.project_legacy_code),
  import_project_label: txt(row.project_label),
});

const getImportKeys = (profileData) => {
  if (!profileData || typeof profileData !== "object") return [];
  const keys = new Set();
  const primary = txt(profileData.import_source_key);
  if (primary) keys.add(primary);
  const aliases = Array.isArray(profileData.import_source_keys) ? profileData.import_source_keys : [];
  aliases.map((value) => txt(value)).filter(Boolean).forEach((value) => keys.add(value));
  return [...keys];
};

const addContactIndex = (index, contact) => {
  if (!contact?.id) return;
  index.byId.set(contact.id, contact);
  const email = txt(contact.email)?.toLowerCase();
  const phone = txt(contact.phone);
  if (email) index.byEmail.set(email, contact);
  if (phone) index.byPhone.set(phone, contact);
};

const addClientIndex = (index, client) => {
  if (!client?.id) return;
  index.byId.set(client.id, client);
  const taxId = txt(client.tax_id);
  const contactId = txt(client.contact_id);
  const profileData = client.profile_data && typeof client.profile_data === "object" ? client.profile_data : {};
  const importKeys = getImportKeys(profileData);
  if (taxId) index.byTax.set(taxId, client);
  if (contactId) index.byContactId.set(contactId, client);
  importKeys.forEach((importKey) => index.byImportKey.set(importKey, client));
};

const addAgencyIndex = (index, agency) => {
  if (!agency?.id) return;
  index.byId.set(agency.id, agency);
  const clientId = txt(agency.client_id);
  if (clientId) index.byClientId.set(clientId, agency);
};

const addAgencyContactIndex = (index, row) => {
  if (!row?.id) return;
  index.byId.set(row.id, row);
  const agencyId = txt(row.agency_id);
  const contactId = txt(row.contact_id);
  const role = txt(row.role) ?? "agent";
  if (agencyId && contactId) {
    index.byAgencyContactRole.set(`${agencyId}|${contactId}|${role}`, row);
    const rows = index.byContactId.get(contactId) ?? [];
    rows.push(row);
    index.byContactId.set(contactId, rows);
    const agencyRows = index.byAgencyId.get(agencyId) ?? [];
    agencyRows.push(row);
    index.byAgencyId.set(agencyId, agencyRows);
  }
};

const resolveClientByAgencyContact = (contactId, state) => {
  if (!contactId) return null;
  const agencyContactRows = state.agencyContactsIndex.byContactId.get(contactId) ?? [];
  if (!agencyContactRows.length) return null;
  const clientIds = [
    ...new Set(
      agencyContactRows
        .map((row) => state.agenciesIndex.byId.get(row.agency_id)?.client_id)
        .map((value) => txt(value))
        .filter(Boolean)
    ),
  ];
  if (clientIds.length !== 1) return null;
  return state.clientsIndex.byId.get(clientIds[0]) ?? null;
};

const resolveClientByBrand = (row, state) => {
  const brandKey = normalizeBrand(txt(row.agency_name) ?? txt(row.legal_name));
  if (!brandKey) return null;
  const candidates = state.agencyBrandIndex.byBrandKey.get(brandKey) ?? [];
  if (!candidates.length) return null;
  const rowDomain = emailDomain(row.email);
  const domainMatches = rowDomain ? candidates.filter((candidate) => candidate.domains.has(rowDomain)) : [];
  const narrowed = domainMatches.length ? domainMatches : candidates;
  const clientIds = [...new Set(narrowed.map((candidate) => txt(candidate.client?.id)).filter(Boolean))];
  if (clientIds.length !== 1) return null;
  return state.clientsIndex.byId.get(clientIds[0]) ?? null;
};

const resolveAgencyAgentContactByName = (agencyId, agentName, state) => {
  const normalizedAgentName = normalizeName(agentName);
  if (!agencyId || !normalizedAgentName) return null;
  const agencyContacts = state.agencyContactsIndex.byAgencyId.get(agencyId) ?? [];
  for (const agencyContact of agencyContacts) {
    if ((txt(agencyContact.role) ?? "agent") !== "agent") continue;
    const contact = state.contactsIndex.byId.get(agencyContact.contact_id) ?? null;
    if (!contact) continue;
    if (normalizeName(contact.full_name) !== normalizedAgentName) continue;
    return { contact, agencyContact };
  }
  return null;
};

const fetchAllRows = async (table, select) => {
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await db
      .schema("crm")
      .from(table)
      .select(select)
      .eq("organization_id", ORGANIZATION_ID)
      .range(from, to);
    if (error) throw new Error(`db_${table}_read_error:${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
};

const fetchOrgState = async () => {
  const [contactsRes, clientsRes, agenciesRes, agencyContactsRes] = await Promise.all([
    fetchAllRows("contacts", CONTACT_SELECT),
    fetchAllRows("clients", CLIENT_SELECT),
    fetchAllRows("agencies", AGENCY_SELECT),
    fetchAllRows("agency_contacts", AGENCY_CONTACT_SELECT),
  ]);

  const contactsIndex = { byId: new Map(), byEmail: new Map(), byPhone: new Map() };
  const clientsIndex = { byId: new Map(), byTax: new Map(), byContactId: new Map(), byImportKey: new Map() };
  const agenciesIndex = { byId: new Map(), byClientId: new Map() };
  const agencyContactsIndex = { byId: new Map(), byAgencyContactRole: new Map(), byContactId: new Map(), byAgencyId: new Map() };

  contactsRes.forEach((row) => addContactIndex(contactsIndex, row));
  clientsRes.forEach((row) => addClientIndex(clientsIndex, row));
  agenciesRes.forEach((row) => addAgencyIndex(agenciesIndex, row));
  agencyContactsRes.forEach((row) => addAgencyContactIndex(agencyContactsIndex, row));
  const agencyBrandIndex = { byBrandKey: new Map() };
  agenciesRes.forEach((agency) => {
    const client = clientsIndex.byId.get(agency.client_id) ?? null;
    if (!client) return;
    const baseContact = client.contact_id ? contactsIndex.byId.get(client.contact_id) ?? null : null;
    const linkedRows = agencyContactsIndex.byContactId;
    const agencyContactRows = [...agencyContactsIndex.byId.values()].filter((row) => row.agency_id === agency.id);
    const linkedContacts = agencyContactRows
      .map((row) => contactsIndex.byId.get(row.contact_id))
      .filter(Boolean);
    const displayName = buildAgencyDisplayName({ agency, client, baseContact });
    const brandKey = normalizeBrand(displayName);
    if (!brandKey) return;
    const domains = new Set(
      [emailDomain(baseContact?.email), ...linkedContacts.map((contact) => emailDomain(contact?.email))]
        .filter(Boolean)
    );
    const rows = agencyBrandIndex.byBrandKey.get(brandKey) ?? [];
    rows.push({ agency, client, baseContact, domains });
    agencyBrandIndex.byBrandKey.set(brandKey, rows);
  });

  return { contactsIndex, clientsIndex, agenciesIndex, agencyContactsIndex, agencyBrandIndex };
};

const updateRow = async ({ table, id, payload, select }) => {
  const { data, error } = await db
    .schema("crm")
    .from(table)
    .update(payload)
    .eq("organization_id", ORGANIZATION_ID)
    .eq("id", id)
    .select(select)
    .single();
  if (error) throw new Error(`db_${table}_update_error:${error.message}`);
  return data;
};

const insertRow = async ({ table, payload, select }) => {
  const { data, error } = await db.schema("crm").from(table).insert(payload).select(select).single();
  if (error) throw new Error(`db_${table}_insert_error:${error.message}`);
  return data;
};

const findAgencyByClientId = async (clientId) => {
  const { data, error } = await db
    .schema("crm")
    .from("agencies")
    .select(AGENCY_SELECT)
    .eq("organization_id", ORGANIZATION_ID)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(`db_agencies_lookup_error:${error.message}`);
  return data ?? null;
};

const findAgencyContactByKey = async (agencyId, contactId, role = "agent") => {
  const { data, error } = await db
    .schema("crm")
    .from("agency_contacts")
    .select(AGENCY_CONTACT_SELECT)
    .eq("organization_id", ORGANIZATION_ID)
    .eq("agency_id", agencyId)
    .eq("contact_id", contactId)
    .eq("role", role)
    .maybeSingle();
  if (error) throw new Error(`db_agency_contacts_lookup_error:${error.message}`);
  return data ?? null;
};

const ensureBaseContact = async (row, state, stats) => {
  const email = txt(row.email)?.toLowerCase();
  const phone = txt(row.phone);
  const importKey = txt(row.dedupe_key);
  const taxId = txt(row.tax_id);
  const targetName = buildBaseContactName(row);
  let matchedBy = null;
  const existingClient =
    state.clientsIndex.byImportKey.get(importKey) ??
    state.clientsIndex.byTax.get(taxId) ??
    null;
  let contact = state.contactsIndex.byEmail.get(email) ?? state.contactsIndex.byPhone.get(phone) ?? null;

  if (!contact) {
    const clientContactId = txt(existingClient?.contact_id);
    if (clientContactId && state.contactsIndex.byId.has(clientContactId)) {
      contact = state.contactsIndex.byId.get(clientContactId);
      matchedBy = state.clientsIndex.byImportKey.get(importKey) ? "client_import_source_key" : "client_tax_id";
    }
  }

  if (contact) {
    if (!matchedBy) {
      matchedBy = state.contactsIndex.byEmail.get(email) ? "email" : "phone";
    }
    if (UPDATE_EXISTING) {
      const patch = {};
      if (!txt(contact.full_name) && targetName) patch.full_name = targetName;
      if (!txt(contact.email) && email) patch.email = email;
      if (!txt(contact.phone) && phone) patch.phone = phone;
      if (!txt(contact.notes) && txt(row.combined_comments)) patch.notes = txt(row.combined_comments);
      if (Object.keys(patch).length) {
        const next = APPLY
          ? await updateRow({ table: "contacts", id: contact.id, payload: patch, select: CONTACT_SELECT })
          : { ...contact, ...patch };
        contact = next;
        stats.contacts_updated += 1;
        addContactIndex(state.contactsIndex, contact);
      }
    }
    return { contact, action: "reused", matched_by: matchedBy };
  }

  const payload = {
    organization_id: ORGANIZATION_ID,
    contact_type: "agency",
    full_name: targetName,
    email,
    phone,
    notes: txt(row.combined_comments),
  };
  const created = APPLY
    ? await insertRow({ table: "contacts", payload, select: CONTACT_SELECT })
    : { id: `dry_contact_${crypto.randomUUID()}`, ...payload };
  stats.contacts_created += 1;
  addContactIndex(state.contactsIndex, created);
  return { contact: created, action: "created", matched_by: "new" };
};

const ensureClient = async (row, baseContact, state, stats) => {
  const importKey = txt(row.dedupe_key);
  const taxId = txt(row.tax_id);
  let matchedBy = null;
  let client =
    state.clientsIndex.byImportKey.get(importKey) ??
    state.clientsIndex.byTax.get(taxId) ??
    state.clientsIndex.byContactId.get(baseContact.id) ??
    resolveClientByAgencyContact(baseContact.id, state) ??
    (shouldSkipBrandMatch(row) ? null : resolveClientByBrand(row, state)) ??
    null;

  if (client) {
    matchedBy =
      state.clientsIndex.byImportKey.get(importKey) ? "import_source_key" :
      state.clientsIndex.byTax.get(taxId) ? "tax_id" :
      state.clientsIndex.byContactId.get(baseContact.id) ? "contact_id" :
      resolveClientByAgencyContact(baseContact.id, state) ? "agency_contact" :
      "brand";
    if (UPDATE_EXISTING) {
      const profileData = client.profile_data && typeof client.profile_data === "object" ? { ...client.profile_data } : {};
      const nextProfile = { ...profileData };
      const nextImportKeys = new Set(getImportKeys(profileData));
      if (importKey) nextImportKeys.add(importKey);
      if (!txt(nextProfile.import_source_key) && importKey) nextProfile.import_source_key = importKey;
      if (nextImportKeys.size) nextProfile.import_source_keys = [...nextImportKeys];
      if (!txt(nextProfile.agency_name) && txt(row.agency_name)) nextProfile.agency_name = txt(row.agency_name);
      if (!txt(nextProfile.agent_name) && txt(row.agent_name)) nextProfile.agent_name = txt(row.agent_name);
      if (!txt(nextProfile.intake_date) && txt(row.intake_date)) nextProfile.intake_date = txt(row.intake_date);
      if (!txt(nextProfile.comments) && txt(row.combined_comments)) nextProfile.comments = txt(row.combined_comments);
      if (!txt(nextProfile.preferred_location) && txt(row.project_label)) nextProfile.preferred_location = txt(row.project_label);

      const patch = {};
      if (!txt(client.tax_id) && taxId) patch.tax_id = taxId;
      if (!txt(client.billing_name) && buildBaseContactName(row)) patch.billing_name = buildBaseContactName(row);
      if (JSON.stringify(nextProfile) !== JSON.stringify(profileData)) patch.profile_data = nextProfile;
      if (Object.keys(patch).length) {
        const next = APPLY
          ? await updateRow({ table: "clients", id: client.id, payload: patch, select: CLIENT_SELECT })
          : { ...client, ...patch };
        client = next;
        stats.clients_updated += 1;
        addClientIndex(state.clientsIndex, client);
      }
    }
    return { client, action: "reused", matched_by: matchedBy };
  }

  const payload = {
    organization_id: ORGANIZATION_ID,
    contact_id: baseContact.id,
    client_code: `CLI-AG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    client_type: "company",
    client_status: buildAgencyStatus(row) === "discarded" ? "discarded" : "active",
    billing_name: buildBaseContactName(row),
    tax_id: taxId,
    billing_address: {},
    profile_data: buildProfileData(row),
  };
  const created = APPLY
    ? await insertRow({ table: "clients", payload, select: CLIENT_SELECT })
    : { id: `dry_client_${crypto.randomUUID()}`, ...payload };
  stats.clients_created += 1;
  addClientIndex(state.clientsIndex, created);
  return { client: created, action: "created", matched_by: "new" };
};

const ensureAgency = async (row, client, state, stats) => {
  let agency = state.agenciesIndex.byClientId.get(client.id) ?? null;
  if (agency) {
    if (UPDATE_EXISTING) {
      const patch = {};
      const nextNotes = buildAgencyNotes(row);
      const nextStatus = buildAgencyStatus(row);
      if (!txt(agency.notes) && nextNotes) patch.notes = nextNotes;
      if ((!txt(agency.agency_status) || agency.agency_status === "inactive") && agency.agency_status !== nextStatus) {
        patch.agency_status = nextStatus;
      }
      if (Object.keys(patch).length) {
        const next = APPLY
          ? await updateRow({ table: "agencies", id: agency.id, payload: patch, select: AGENCY_SELECT })
          : { ...agency, ...patch };
        agency = next;
        stats.agencies_updated += 1;
        addAgencyIndex(state.agenciesIndex, agency);
      }
    }
    return { agency, action: "reused" };
  }

  const payload = {
    organization_id: ORGANIZATION_ID,
    client_id: client.id,
    agency_code: `AG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    agency_status: buildAgencyStatus(row),
    agency_scope: "mixed",
    is_referral_source: true,
    notes: buildAgencyNotes(row),
  };
  let created;
  if (APPLY) {
    try {
      created = await insertRow({ table: "agencies", payload, select: AGENCY_SELECT });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("agencies_organization_id_client_id_key")) throw error;
      const existing = await findAgencyByClientId(client.id);
      if (!existing) throw error;
      addAgencyIndex(state.agenciesIndex, existing);
      return { agency: existing, action: "reused" };
    }
  } else {
    created = { id: `dry_agency_${crypto.randomUUID()}`, ...payload };
  }
  stats.agencies_created += 1;
  addAgencyIndex(state.agenciesIndex, created);
  return { agency: created, action: "created" };
};

const ensureAgentContact = async (row, agency, baseContact, state, stats) => {
  const agentName = txt(row.agent_name);
  if (!agentName) return { contact: null, agency_contact: null, contact_action: "skipped", agency_contact_action: "skipped" };

  if (normalizeName(agentName) === normalizeName(baseContact.full_name)) {
    return { contact: baseContact, agency_contact: null, contact_action: "same_as_base", agency_contact_action: "skipped" };
  }

  const email = txt(row.email)?.toLowerCase();
  const phone = txt(row.phone);
  let contact =
    state.contactsIndex.byEmail.get(email) ??
    state.contactsIndex.byPhone.get(phone) ??
    null;
  if (!contact) {
    const existingAgencyAgent = resolveAgencyAgentContactByName(agency.id, agentName, state);
    if (existingAgencyAgent) {
      return {
        contact: existingAgencyAgent.contact,
        agency_contact: existingAgencyAgent.agencyContact,
        contact_action: "reused",
        agency_contact_action: "reused",
      };
    }
  }

  if (!contact) {
    const payload = {
      organization_id: ORGANIZATION_ID,
      contact_type: "agency",
      full_name: agentName,
      email,
      phone,
      notes: buildAgencyNotes(row),
    };
    contact = APPLY
      ? await insertRow({ table: "contacts", payload, select: CONTACT_SELECT })
      : { id: `dry_agent_contact_${crypto.randomUUID()}`, ...payload };
    stats.agent_contacts_created += 1;
    addContactIndex(state.contactsIndex, contact);
  }

  const indexKey = `${agency.id}|${contact.id}|agent`;
  let agencyContact = state.agencyContactsIndex.byAgencyContactRole.get(indexKey) ?? null;
  if (agencyContact) {
    return { contact, agency_contact: agencyContact, contact_action: "reused", agency_contact_action: "reused" };
  }

  const payload = {
    organization_id: ORGANIZATION_ID,
    agency_id: agency.id,
    contact_id: contact.id,
    role: "agent",
    relation_status: "active",
    is_primary: true,
    notes: buildAgencyNotes(row),
  };
  if (APPLY) {
    try {
      agencyContact = await insertRow({ table: "agency_contacts", payload, select: AGENCY_CONTACT_SELECT });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("agency_contacts_agency_id_contact_id_role_key")) throw error;
      agencyContact = await findAgencyContactByKey(agency.id, contact.id, "agent");
      if (!agencyContact) throw error;
      addAgencyContactIndex(state.agencyContactsIndex, agencyContact);
      return { contact, agency_contact: agencyContact, contact_action: "created_or_reused", agency_contact_action: "reused" };
    }
  } else {
    agencyContact = { id: `dry_agency_contact_${crypto.randomUUID()}`, ...payload };
  }
  stats.agency_contacts_created += 1;
  addAgencyContactIndex(state.agencyContactsIndex, agencyContact);
  return { contact, agency_contact: agencyContact, contact_action: "created_or_reused", agency_contact_action: "created" };
};

const main = async () => {
  ensureDir(REFERENCE_DIR);
  ensureDir(REPORTS_DIR);

  const state = await fetchOrgState();
  const inputRows = readJson(INPUT_JSON);
  const rows = LIMIT ? inputRows.slice(0, LIMIT) : inputRows;
  const importableRows = rows.filter((row) => isImportableAgencyRow(row));
  const stats = {
    skipped_weak_rows: rows.length - importableRows.length,
    contacts_created: 0,
    contacts_updated: 0,
    clients_created: 0,
    clients_updated: 0,
    agencies_created: 0,
    agencies_updated: 0,
    agent_contacts_created: 0,
    agency_contacts_created: 0,
    processed: 0,
  };
  const mapRows = [];

  for (const row of importableRows) {
    const base = await ensureBaseContact(row, state, stats);
    const client = await ensureClient(row, base.contact, state, stats);
    const agency = await ensureAgency(row, client.client, state, stats);
    const agent = await ensureAgentContact(row, agency.agency, base.contact, state, stats);

    mapRows.push({
      dedupe_key: row.dedupe_key ?? "",
      project_label: row.project_label ?? "",
      project_legacy_code: row.project_legacy_code ?? "",
      source_file: row.source_file ?? "",
      source_row_number: row.source_row_number ?? "",
      agency_name: row.agency_name ?? "",
      agent_name: row.agent_name ?? "",
      email: row.email ?? "",
      phone: row.phone ?? "",
      tax_id: row.tax_id ?? "",
      base_contact_id: base.contact?.id ?? "",
      client_id: client.client?.id ?? "",
      agency_id: agency.agency?.id ?? "",
      agent_contact_id: agent.contact?.id ?? "",
      agency_contact_id: agent.agency_contact?.id ?? "",
      base_contact_action: base.action,
      base_contact_matched_by: base.matched_by,
      client_action: client.action,
      client_matched_by: client.matched_by,
      agency_action: agency.action,
      agent_contact_action: agent.contact_action,
      agency_contact_action: agent.agency_contact_action,
    });
    stats.processed += 1;
  }

  const runTs = timestamp();
  const mapBaseName = APPLY ? "agency-db-map-latest" : "agency-db-map-dry-run-latest";
  const mapCsv = path.join(REFERENCE_DIR, `${mapBaseName}.csv`);
  const mapJson = path.join(REFERENCE_DIR, `${mapBaseName}.json`);
  const reportJson = path.join(REPORTS_DIR, `agency-import-db-${runTs}.json`);

  writeCsv(mapCsv, mapRows, [
    "dedupe_key",
    "project_label",
    "project_legacy_code",
    "source_file",
    "source_row_number",
    "agency_name",
    "agent_name",
    "email",
    "phone",
    "tax_id",
    "base_contact_id",
    "client_id",
    "agency_id",
    "agent_contact_id",
    "agency_contact_id",
    "base_contact_action",
    "base_contact_matched_by",
    "client_action",
    "client_matched_by",
    "agency_action",
    "agent_contact_action",
    "agency_contact_action",
  ]);
  writeJson(mapJson, mapRows);
  writeJson(reportJson, {
    generated_at: new Date().toISOString(),
    organization_id: ORGANIZATION_ID,
    apply: APPLY,
    input_json: relativeFromRoot(INPUT_JSON),
    totals: stats,
    outputs: {
      agency_db_map_csv: relativeFromRoot(mapCsv),
      agency_db_map_json: relativeFromRoot(mapJson),
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        apply: APPLY,
        organization_id: ORGANIZATION_ID,
        input_rows: rows.length,
        totals: stats,
        outputs: {
          agency_db_map_csv: relativeFromRoot(mapCsv),
          agency_db_map_json: relativeFromRoot(mapJson),
          report_json: relativeFromRoot(reportJson),
        },
      },
      null,
      2
    )
  );
};

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
