import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  ROOT,
  arg,
  canonical,
  ensureDir,
  normalizeEmail,
  normalizePhone,
  parseEnvFile,
  relativeFromRoot,
  timestamp,
  txt,
  writeCsv,
  writeJson,
} from "./agency-import/shared.mjs";

const PAGE_SIZE = 1000;
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
const APPLY = flag("apply");
const ORGANIZATION_ID = txt(arg("organization-id")) ?? env("CRM_ORGANIZATION_ID");
const SUPABASE_URL = env("SUPABASE_URL") ?? env("PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

if (!ORGANIZATION_ID) throw new Error("organization_id_required");
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("supabase_credentials_required");

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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

const updateRef = async (table, id, patch) => {
  const { error } = await db.schema("crm").from(table).update(patch).eq("organization_id", ORGANIZATION_ID).eq("id", id);
  if (error) throw new Error(`db_${table}_update_error:${error.message}`);
};

const deleteRef = async (table, id) => {
  const { error } = await db.schema("crm").from(table).delete().eq("organization_id", ORGANIZATION_ID).eq("id", id);
  if (error) throw new Error(`db_${table}_delete_error:${error.message}`);
};

const asObjectRecord = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
};

const parseIso = (value) => {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
};

const groupBy = (rows, getter) => {
  const out = new Map();
  for (const row of rows) {
    const key = getter(row);
    if (!key) continue;
    const bucket = out.get(key) ?? [];
    bucket.push(row);
    out.set(key, bucket);
  }
  return out;
};

const normalizeName = (value) => {
  const normalized = canonical(value);
  return normalized && normalized.length >= 3 ? normalized : null;
};

const isQuestionName = (value) => {
  const text = txt(value);
  if (!text) return true;
  return /^(\?|\u00bf)+$/.test(text.trim());
};

const isGenericContactName = (contactName, agencyName) => {
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

const buildIdentityParts = (contact) => {
  const email = normalizeEmail(contact?.email);
  const phone = normalizePhone(contact?.phone);
  const name = normalizeName(contact?.full_name);
  return { email, phone, name };
};

const buildIdentityKey = (row, contact) => {
  const roleKey = canonical(row.role);
  const { email, phone, name } = buildIdentityParts(contact);
  if (email) return { type: "email", key: `${row.agency_id}|${roleKey}|email:${email}`, email, phone, name };
  if (phone) return { type: "phone", key: `${row.agency_id}|${roleKey}|phone:${phone}`, email, phone, name };
  if (name && !isQuestionName(contact?.full_name)) {
    return { type: "name", key: `${row.agency_id}|${roleKey}|name:${name}`, email, phone, name };
  }
  return null;
};

const buildAgencyLabel = (agency, client, contact) =>
  txt(client?.billing_name) ??
  txt(client?.profile_data?.agency_name) ??
  txt(client?.profile_data?.agent_name) ??
  txt(contact?.full_name) ??
  txt(agency?.agency_code) ??
  "Agencia";

const buildContactPatch = (canonicalEntry, duplicates) => {
  const canonicalContact = canonicalEntry.contact ?? {};
  const canonicalAgencyName = canonicalEntry.agency_name;
  const patch = {};

  const bestNamed = [canonicalEntry, ...duplicates].find(
    (entry) => !isGenericContactName(entry.contact?.full_name, canonicalAgencyName) && txt(entry.contact?.full_name)
  );
  if (
    (!txt(canonicalContact.full_name) || isGenericContactName(canonicalContact.full_name, canonicalAgencyName)) &&
    txt(bestNamed?.contact?.full_name)
  ) {
    patch.full_name = txt(bestNamed.contact.full_name);
  }

  if (!normalizeEmail(canonicalContact.email)) {
    const bestEmail = [canonicalEntry, ...duplicates].map((entry) => normalizeEmail(entry.contact?.email)).find(Boolean);
    if (bestEmail) patch.email = bestEmail;
  }

  if (!normalizePhone(canonicalContact.phone)) {
    const bestPhone = [canonicalEntry, ...duplicates].map((entry) => normalizePhone(entry.contact?.phone)).find(Boolean);
    if (bestPhone) patch.phone = bestPhone;
  }

  return patch;
};

const patchLeadRawPayloadAgencyContactId = (rawPayloadValue, duplicateId, canonicalId) => {
  const rawPayload = asObjectRecord(rawPayloadValue);
  const nextRawPayload = { ...rawPayload };
  let changed = false;

  if (txt(nextRawPayload.agency_contact_id) === duplicateId) {
    nextRawPayload.agency_contact_id = canonicalId;
    changed = true;
  }

  const mapped = asObjectRecord(nextRawPayload.mapped);
  if (Object.keys(mapped).length > 0 || txt(mapped.agency_contact_id) === duplicateId) {
    const nextMapped = { ...mapped };
    if (txt(nextMapped.agency_contact_id) === duplicateId) {
      nextMapped.agency_contact_id = canonicalId;
      changed = true;
    }
    nextRawPayload.mapped = nextMapped;
  }

  return changed ? nextRawPayload : null;
};

const main = async () => {
  ensureDir(REPORTS_DIR);

  const [agencies, clients, contacts, agencyContacts, leads] = await Promise.all([
    fetchAllRows("agencies", "id, organization_id, client_id, agency_code, agency_status, created_at, updated_at"),
    fetchAllRows("clients", "id, organization_id, contact_id, billing_name, profile_data, created_at, updated_at"),
    fetchAllRows("contacts", "id, organization_id, full_name, email, phone, created_at, updated_at"),
    fetchAllRows(
      "agency_contacts",
      "id, organization_id, agency_id, contact_id, role, relation_status, is_primary, notes, created_at, updated_at"
    ),
    fetchAllRows("leads", "id, organization_id, contact_id, raw_payload"),
  ]);

  const agencyById = new Map(agencies.map((row) => [row.id, row]));
  const clientById = new Map(clients.map((row) => [row.id, row]));
  const contactById = new Map(contacts.map((row) => [row.id, row]));
  const agencyContactsByContactId = groupBy(agencyContacts, (row) => txt(row.contact_id));
  const clientsByContactId = groupBy(clients, (row) => txt(row.contact_id));
  const leadsByContactId = groupBy(leads, (row) => txt(row.contact_id));

  const duplicateGroupsByKey = new Map();
  for (const row of agencyContacts) {
    const contact = contactById.get(row.contact_id) ?? null;
    const identity = buildIdentityKey(row, contact);
    if (!identity) continue;
    const agency = agencyById.get(row.agency_id) ?? null;
    const client = agency?.client_id ? clientById.get(agency.client_id) ?? null : null;
    const baseContact = client?.contact_id ? contactById.get(client.contact_id) ?? null : null;
    const agencyName = buildAgencyLabel(agency, client, baseContact);
    const bucket = duplicateGroupsByKey.get(identity.key) ?? [];
    bucket.push({
      identity_type: identity.type,
      identity_email: identity.email ?? "",
      identity_phone: identity.phone ?? "",
      identity_name: identity.name ?? "",
      agency_name: agencyName,
      agency_contact: row,
      contact,
      client_refs: (clientsByContactId.get(row.contact_id) ?? []).length,
      lead_refs: (leadsByContactId.get(row.contact_id) ?? []).length,
      agency_contact_refs: (agencyContactsByContactId.get(row.contact_id) ?? []).length,
    });
    duplicateGroupsByKey.set(identity.key, bucket);
  }

  const duplicateGroups = [...duplicateGroupsByKey.entries()]
    .map(([key, entries]) => ({ key, entries }))
    .filter(({ entries }) => entries.length > 1 && new Set(entries.map((entry) => entry.agency_contact.contact_id)).size > 1)
    .sort((a, b) => b.entries.length - a.entries.length);

  const actions = [];
  const groupsReport = [];
  const contactDeleteCandidates = new Map();
  const totals = {
    duplicate_groups: duplicateGroups.length,
    duplicate_rows: duplicateGroups.reduce((sum, group) => sum + group.entries.length, 0),
    duplicate_extras: duplicateGroups.reduce((sum, group) => sum + group.entries.length - 1, 0),
    client_contact_refs_relinked: 0,
    lead_contact_refs_relinked: 0,
    lead_raw_payload_refs_relinked: 0,
    contacts_updated: 0,
    agency_contacts_updated: 0,
    agency_contacts_deleted: 0,
    contacts_deleted: 0,
    orphan_contacts_skipped: 0,
  };

  for (const group of duplicateGroups) {
    const ranked = [...group.entries].sort((a, b) => {
      const scoreA =
        a.client_refs * 1000 +
        a.lead_refs * 250 +
        Number(a.agency_contact.relation_status === "active") * 120 +
        Number(a.agency_contact.is_primary === true) * 60 +
        Number(!isGenericContactName(a.contact?.full_name, a.agency_name)) * 30 +
        Number(Boolean(normalizeEmail(a.contact?.email))) * 15 +
        Number(Boolean(normalizePhone(a.contact?.phone))) * 12 -
        parseIso(a.contact?.created_at ?? a.agency_contact.created_at) / 1_000_000_000_000;
      const scoreB =
        b.client_refs * 1000 +
        b.lead_refs * 250 +
        Number(b.agency_contact.relation_status === "active") * 120 +
        Number(b.agency_contact.is_primary === true) * 60 +
        Number(!isGenericContactName(b.contact?.full_name, b.agency_name)) * 30 +
        Number(Boolean(normalizeEmail(b.contact?.email))) * 15 +
        Number(Boolean(normalizePhone(b.contact?.phone))) * 12 -
        parseIso(b.contact?.created_at ?? b.agency_contact.created_at) / 1_000_000_000_000;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return parseIso(a.contact?.created_at ?? a.agency_contact.created_at) - parseIso(b.contact?.created_at ?? b.agency_contact.created_at);
    });

    const canonicalEntry = ranked[0];
    const duplicates = ranked.slice(1);
    const canonicalAgencyContactId = canonicalEntry.agency_contact.id;
    const canonicalContactId = canonicalEntry.agency_contact.contact_id;

    const canonicalAgencyContactPatch = {};
    if (canonicalEntry.agency_contact.relation_status !== "active" && duplicates.some((entry) => entry.agency_contact.relation_status === "active")) {
      canonicalAgencyContactPatch.relation_status = "active";
    }
    if (canonicalEntry.agency_contact.is_primary !== true && duplicates.some((entry) => entry.agency_contact.is_primary === true)) {
      canonicalAgencyContactPatch.is_primary = true;
    }
    if (!txt(canonicalEntry.agency_contact.notes)) {
      const noteValue = duplicates.map((entry) => txt(entry.agency_contact.notes)).find(Boolean);
      if (noteValue) canonicalAgencyContactPatch.notes = noteValue;
    }
    if (Object.keys(canonicalAgencyContactPatch).length) {
      actions.push({
        type: "update",
        table: "agency_contacts",
        id: canonicalAgencyContactId,
        patch: canonicalAgencyContactPatch,
        group_key: group.key,
        agency_id: canonicalEntry.agency_contact.agency_id,
        agency_name: canonicalEntry.agency_name,
        canonical_agency_contact_id: canonicalAgencyContactId,
        canonical_contact_id: canonicalContactId,
        duplicate_agency_contact_id: "",
        duplicate_contact_id: "",
        note: "agency_contacts.promote_canonical",
      });
    }

    const contactPatch = buildContactPatch(canonicalEntry, duplicates);
    if (Object.keys(contactPatch).length) {
      actions.push({
        type: "update",
        table: "contacts",
        id: canonicalContactId,
        patch: contactPatch,
        group_key: group.key,
        agency_id: canonicalEntry.agency_contact.agency_id,
        agency_name: canonicalEntry.agency_name,
        canonical_agency_contact_id: canonicalAgencyContactId,
        canonical_contact_id: canonicalContactId,
        duplicate_agency_contact_id: "",
        duplicate_contact_id: "",
        note: "contacts.promote_canonical",
      });
    }

    for (const duplicateEntry of duplicates) {
      const duplicateAgencyContactId = duplicateEntry.agency_contact.id;
      const duplicateContactId = duplicateEntry.agency_contact.contact_id;

      for (const clientRow of clientsByContactId.get(duplicateContactId) ?? []) {
        actions.push({
          type: "update",
          table: "clients",
          id: clientRow.id,
          patch: { contact_id: canonicalContactId },
          group_key: group.key,
          agency_id: canonicalEntry.agency_contact.agency_id,
          agency_name: canonicalEntry.agency_name,
          canonical_agency_contact_id: canonicalAgencyContactId,
          canonical_contact_id: canonicalContactId,
          duplicate_agency_contact_id: duplicateAgencyContactId,
          duplicate_contact_id: duplicateContactId,
          note: "clients.contact_id",
        });
      }

      for (const leadRow of leadsByContactId.get(duplicateContactId) ?? []) {
        actions.push({
          type: "update",
          table: "leads",
          id: leadRow.id,
          patch: { contact_id: canonicalContactId },
          group_key: group.key,
          agency_id: canonicalEntry.agency_contact.agency_id,
          agency_name: canonicalEntry.agency_name,
          canonical_agency_contact_id: canonicalAgencyContactId,
          canonical_contact_id: canonicalContactId,
          duplicate_agency_contact_id: duplicateAgencyContactId,
          duplicate_contact_id: duplicateContactId,
          note: "leads.contact_id",
        });
      }

      for (const leadRow of leads) {
        const nextRawPayload = patchLeadRawPayloadAgencyContactId(leadRow.raw_payload, duplicateAgencyContactId, canonicalAgencyContactId);
        if (!nextRawPayload) continue;
        actions.push({
          type: "update",
          table: "leads",
          id: leadRow.id,
          patch: { raw_payload: nextRawPayload },
          group_key: group.key,
          agency_id: canonicalEntry.agency_contact.agency_id,
          agency_name: canonicalEntry.agency_name,
          canonical_agency_contact_id: canonicalAgencyContactId,
          canonical_contact_id: canonicalContactId,
          duplicate_agency_contact_id: duplicateAgencyContactId,
          duplicate_contact_id: duplicateContactId,
          note: "leads.raw_payload.agency_contact_id",
        });
      }

      actions.push({
        type: "delete",
        table: "agency_contacts",
        id: duplicateAgencyContactId,
        group_key: group.key,
        agency_id: canonicalEntry.agency_contact.agency_id,
        agency_name: canonicalEntry.agency_name,
        canonical_agency_contact_id: canonicalAgencyContactId,
        canonical_contact_id: canonicalContactId,
        duplicate_agency_contact_id: duplicateAgencyContactId,
        duplicate_contact_id: duplicateContactId,
        note: "delete_duplicate_agency_contact",
      });

      const current = contactDeleteCandidates.get(duplicateContactId) ?? {
        delete_candidate: true,
        agency_contact_refs_removed: 0,
        client_refs_relinked: 0,
        lead_refs_relinked: 0,
      };
      current.agency_contact_refs_removed += 1;
      current.client_refs_relinked += (clientsByContactId.get(duplicateContactId) ?? []).length;
      current.lead_refs_relinked += (leadsByContactId.get(duplicateContactId) ?? []).length;
      contactDeleteCandidates.set(duplicateContactId, current);
    }

    groupsReport.push({
      group_key: group.key,
      agency_id: canonicalEntry.agency_contact.agency_id,
      agency_name: canonicalEntry.agency_name,
      identity_type: canonicalEntry.identity_type,
      identity_email: canonicalEntry.identity_email,
      identity_phone: canonicalEntry.identity_phone,
      identity_name: canonicalEntry.identity_name,
      canonical_agency_contact_id: canonicalAgencyContactId,
      canonical_contact_id: canonicalContactId,
      duplicate_count: duplicates.length,
      entries_total: group.entries.length,
      action_count: actions.filter((row) => row.group_key === group.key).length,
    });
  }

  for (const [contactId, state] of contactDeleteCandidates.entries()) {
    const initialAgencyContactRefs = (agencyContactsByContactId.get(contactId) ?? []).length;
    const initialClientRefs = (clientsByContactId.get(contactId) ?? []).length;
    const initialLeadRefs = (leadsByContactId.get(contactId) ?? []).length;
    const remainingAgencyContactRefs = Math.max(0, initialAgencyContactRefs - state.agency_contact_refs_removed);
    const remainingClientRefs = Math.max(0, initialClientRefs - state.client_refs_relinked);
    const remainingLeadRefs = Math.max(0, initialLeadRefs - state.lead_refs_relinked);

    if (remainingAgencyContactRefs === 0 && remainingClientRefs === 0 && remainingLeadRefs === 0) {
      actions.push({
        type: "delete",
        table: "contacts",
        id: contactId,
        group_key: "",
        agency_id: "",
        agency_name: "",
        canonical_agency_contact_id: "",
        canonical_contact_id: "",
        duplicate_agency_contact_id: "",
        duplicate_contact_id: contactId,
        note: "delete_orphan_duplicate_contact",
      });
    } else {
      totals.orphan_contacts_skipped += 1;
    }
  }

  totals.client_contact_refs_relinked = actions.filter(
    (row) => row.type === "update" && row.table === "clients" && row.note === "clients.contact_id"
  ).length;
  totals.lead_contact_refs_relinked = actions.filter(
    (row) => row.type === "update" && row.table === "leads" && row.note === "leads.contact_id"
  ).length;
  totals.lead_raw_payload_refs_relinked = actions.filter(
    (row) => row.type === "update" && row.table === "leads" && row.note === "leads.raw_payload.agency_contact_id"
  ).length;
  totals.contacts_updated = actions.filter(
    (row) => row.type === "update" && row.table === "contacts" && row.note === "contacts.promote_canonical"
  ).length;
  totals.agency_contacts_updated = actions.filter(
    (row) => row.type === "update" && row.table === "agency_contacts" && row.note === "agency_contacts.promote_canonical"
  ).length;
  totals.agency_contacts_deleted = actions.filter(
    (row) => row.type === "delete" && row.table === "agency_contacts"
  ).length;
  totals.contacts_deleted = actions.filter((row) => row.type === "delete" && row.table === "contacts").length;

  if (APPLY) {
    for (const action of actions) {
      if (action.type === "update") {
        await updateRef(action.table, action.id, action.patch);
      } else if (action.type === "delete") {
        await deleteRef(action.table, action.id);
      }
    }
  }

  const runTs = timestamp();
  const groupsCsv = path.join(REPORTS_DIR, `agency-contact-dedupe-groups-${runTs}.csv`);
  const actionsCsv = path.join(REPORTS_DIR, `agency-contact-dedupe-actions-${runTs}.csv`);
  const reportJson = path.join(REPORTS_DIR, `agency-contact-dedupe-${runTs}.json`);

  writeCsv(groupsCsv, groupsReport, [
    "group_key",
    "agency_id",
    "agency_name",
    "identity_type",
    "identity_email",
    "identity_phone",
    "identity_name",
    "canonical_agency_contact_id",
    "canonical_contact_id",
    "duplicate_count",
    "entries_total",
    "action_count",
  ]);
  writeCsv(actionsCsv, actions, [
    "type",
    "table",
    "id",
    "group_key",
    "agency_id",
    "agency_name",
    "canonical_agency_contact_id",
    "canonical_contact_id",
    "duplicate_agency_contact_id",
    "duplicate_contact_id",
    "note",
  ]);
  writeJson(reportJson, {
    generated_at: new Date().toISOString(),
    apply: APPLY,
    organization_id: ORGANIZATION_ID,
    totals,
    outputs: {
      groups_csv: relativeFromRoot(groupsCsv),
      actions_csv: relativeFromRoot(actionsCsv),
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        apply: APPLY,
        organization_id: ORGANIZATION_ID,
        totals,
        outputs: {
          groups_csv: relativeFromRoot(groupsCsv),
          actions_csv: relativeFromRoot(actionsCsv),
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
