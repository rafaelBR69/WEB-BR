import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  ROOT,
  arg,
  ensureDir,
  parseEnvFile,
  relativeFromRoot,
  timestamp,
  txt,
  writeCsv,
  writeJson,
} from "./agency-import/shared.mjs";

const PAGE_SIZE = 1000;
const REPORTS_DIR = path.join(ROOT, "scripts", "agency-import", "reports");
const GENERIC_BRAND_KEYS = new Set([
  "autonomo",
  "autonoma",
  "agencia",
  "agency",
  "cliente",
  "sin nombre",
  "todos",
]);
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "yahoo.com",
  "yahoo.es",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmaol.com",
]);

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

const insertAgencyContact = async (payload) => {
  const { data, error } = await db
    .schema("crm")
    .from("agency_contacts")
    .insert(payload)
    .select("id, agency_id, contact_id, role")
    .single();
  if (error) throw new Error(`db_agency_contacts_insert_error:${error.message}`);
  return data;
};

const normalizeText = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.]+/g, " ")
    .trim();

const emailDomain = (value) => {
  const email = txt(value)?.toLowerCase();
  if (!email || !email.includes("@")) return null;
  return email.split("@").pop() ?? null;
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

const safeCount = (map, key) => map.get(key) ?? 0;

const buildDisplayName = (agency, client, baseContact) =>
  txt(client?.billing_name) ??
  txt(client?.profile_data?.agency_name) ??
  txt(baseContact?.full_name) ??
  txt(client?.profile_data?.agent_name) ??
  txt(agency?.agency_code) ??
  "Sin nombre";

const getImportKeys = (profileData) => {
  if (!profileData || typeof profileData !== "object") return [];
  const keys = new Set();
  const primary = txt(profileData.import_source_key);
  if (primary) keys.add(primary);
  const aliases = Array.isArray(profileData.import_source_keys) ? profileData.import_source_keys : [];
  aliases.map((value) => txt(value)).filter(Boolean).forEach((value) => keys.add(value));
  return [...keys];
};

const main = async () => {
  ensureDir(REPORTS_DIR);

  const [
    clients,
    contacts,
    agencies,
    agencyContacts,
    leads,
    deals,
    activities,
    contracts,
    invoices,
    documents,
    portalAccounts,
    clientProjectReservations,
    propertyClientLinks,
    providers,
  ] = await Promise.all([
    fetchAllRows("clients", "id, contact_id, billing_name, tax_id, profile_data, created_at, updated_at"),
    fetchAllRows("contacts", "id, full_name, email, phone"),
    fetchAllRows("agencies", "id, client_id, agency_code, agency_status, created_at, updated_at"),
    fetchAllRows("agency_contacts", "id, agency_id, contact_id, role, is_primary"),
    fetchAllRows("leads", "id, agency_id, converted_agency_id, converted_client_id"),
    fetchAllRows("deals", "id, client_id"),
    fetchAllRows("activities", "id, client_id"),
    fetchAllRows("contracts", "id, client_id"),
    fetchAllRows("invoices", "id, client_id"),
    fetchAllRows("documents", "id, client_id"),
    fetchAllRows("portal_accounts", "id, client_id, agency_id"),
    fetchAllRows("client_project_reservations", "id, client_id, project_property_id, source_file, source_row_number"),
    fetchAllRows("property_client_links", "id, client_id, property_id"),
    fetchAllRows("providers", "id, client_id"),
  ]);

  const clientById = new Map(clients.map((row) => [row.id, row]));
  const contactById = new Map(contacts.map((row) => [row.id, row]));
  const agencyContactsByAgencyId = groupBy(agencyContacts, (row) => txt(row.agency_id));
  const providersByClientId = groupBy(providers, (row) => txt(row.client_id));

  const rows = agencies.map((agency) => {
    const client = clientById.get(agency.client_id) ?? null;
    const baseContact = client?.contact_id ? contactById.get(client.contact_id) ?? null : null;
    const linkedContactRows = (agencyContactsByAgencyId.get(agency.id) ?? [])
      .map((row) => contactById.get(row.contact_id))
      .filter(Boolean);
    const displayName = buildDisplayName(agency, client, baseContact);
    const brandKey = normalizeText(displayName);
    const domains = [
      emailDomain(baseContact?.email),
      ...linkedContactRows.map((row) => emailDomain(row?.email)),
    ].filter((value) => Boolean(value));
    return {
      agency,
      client,
      baseContact,
      linkedAgencyContacts: agencyContactsByAgencyId.get(agency.id) ?? [],
      linkedContactRows,
      displayName,
      brandKey,
      taxId: txt(client?.tax_id),
      domains,
      nonFreeDomains: domains.filter((domain) => domain && !FREE_EMAIL_DOMAINS.has(domain)),
    };
  });

  const groups = [...groupBy(rows, (row) => row.brandKey).entries()]
    .filter(([, bucket]) => bucket.length > 1)
    .map(([brandKey, bucket]) => {
      const domainCounts = new Map();
      bucket.flatMap((row) => row.nonFreeDomains).forEach((domain) => {
        domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
      });
      const sortedDomains = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]);
      const taxIds = [...new Set(bucket.map((row) => row.taxId).filter(Boolean))];
      const dominantDomain = sortedDomains[0]?.[0] ?? null;
      const dominantDomainCount = sortedDomains[0]?.[1] ?? 0;
      const safe =
        !GENERIC_BRAND_KEYS.has(brandKey) &&
        taxIds.length <= 1 &&
        (taxIds.length === 1 || (dominantDomain && dominantDomainCount >= 2 && dominantDomainCount >= Math.ceil(bucket.length / 2)));
      return {
        brandKey,
        label: bucket[0]?.displayName ?? brandKey,
        count: bucket.length,
        taxIds,
        dominantDomain,
        dominantDomainCount,
        status: safe ? "safe" : GENERIC_BRAND_KEYS.has(brandKey) ? "generic_skip" : "manual_review",
        rows: bucket,
      };
    })
    .sort((a, b) => b.count - a.count);

  const clientRefCounts = new Map();
  const agencyRefCounts = new Map();
  const incrementCounts = (rowsInput, keyName, map, extraKeyNames = []) => {
    for (const row of rowsInput) {
      const baseKey = txt(row[keyName]);
      if (baseKey) map.set(baseKey, (map.get(baseKey) ?? 0) + 1);
      for (const extraKeyName of extraKeyNames) {
        const extraKey = txt(row[extraKeyName]);
        if (extraKey) map.set(extraKey, (map.get(extraKey) ?? 0) + 1);
      }
    }
  };

  incrementCounts(leads, "converted_client_id", clientRefCounts);
  incrementCounts(deals, "client_id", clientRefCounts);
  incrementCounts(activities, "client_id", clientRefCounts);
  incrementCounts(contracts, "client_id", clientRefCounts);
  incrementCounts(invoices, "client_id", clientRefCounts);
  incrementCounts(documents, "client_id", clientRefCounts);
  incrementCounts(portalAccounts, "client_id", clientRefCounts);
  incrementCounts(clientProjectReservations, "client_id", clientRefCounts);
  incrementCounts(propertyClientLinks, "client_id", clientRefCounts);
  incrementCounts(providers, "client_id", clientRefCounts);

  incrementCounts(leads, "agency_id", agencyRefCounts, ["converted_agency_id"]);
  incrementCounts(portalAccounts, "agency_id", agencyRefCounts);
  incrementCounts(agencyContacts, "agency_id", agencyRefCounts);
  incrementCounts(agencies, "parent_agency_id", agencyRefCounts);

  const clientUpdateIndex = {
    leads_converted_client_id: groupBy(leads.filter((row) => row.converted_client_id), (row) => row.converted_client_id),
    deals_client_id: groupBy(deals.filter((row) => row.client_id), (row) => row.client_id),
    activities_client_id: groupBy(activities.filter((row) => row.client_id), (row) => row.client_id),
    contracts_client_id: groupBy(contracts.filter((row) => row.client_id), (row) => row.client_id),
    invoices_client_id: groupBy(invoices.filter((row) => row.client_id), (row) => row.client_id),
    documents_client_id: groupBy(documents.filter((row) => row.client_id), (row) => row.client_id),
    portal_accounts_client_id: groupBy(portalAccounts.filter((row) => row.client_id), (row) => row.client_id),
  };
  const agencyUpdateIndex = {
    leads_agency_id: groupBy(leads.filter((row) => row.agency_id), (row) => row.agency_id),
    leads_converted_agency_id: groupBy(leads.filter((row) => row.converted_agency_id), (row) => row.converted_agency_id),
    portal_accounts_agency_id: groupBy(portalAccounts.filter((row) => row.agency_id), (row) => row.agency_id),
    agencies_parent_agency_id: groupBy(agencies.filter((row) => row.parent_agency_id), (row) => row.parent_agency_id),
  };
  const clientMergeIndex = {
    client_project_reservations: groupBy(clientProjectReservations, (row) => row.client_id),
    property_client_links: groupBy(propertyClientLinks, (row) => row.client_id),
  };
  const agencyMergeIndex = {
    agency_contacts: groupBy(agencyContacts, (row) => row.agency_id),
  };

  const groupReports = [];
  const actions = [];
  const totals = {
    duplicate_groups: groups.length,
    safe_groups: 0,
    manual_review_groups: 0,
    generic_skipped_groups: 0,
    duplicate_clients: 0,
    duplicate_agencies: 0,
    rows_updated: 0,
    rows_deleted: 0,
    rows_inserted: 0,
  };

  for (const group of groups) {
    if (group.status !== "safe") {
      if (group.status === "manual_review") totals.manual_review_groups += 1;
      if (group.status === "generic_skip") totals.generic_skipped_groups += 1;
      groupReports.push({
        brand_key: group.brandKey,
        label: group.label,
        status: group.status,
        group_count: group.count,
        dominant_domain: group.dominantDomain ?? "",
        dominant_domain_count: group.dominantDomainCount,
        tax_ids: group.taxIds.join(" | "),
        canonical_agency_id: "",
        duplicate_agency_count: 0,
        action_count: 0,
      });
      continue;
    }

    const enriched = group.rows.map((row) => {
      const clientRefCount = safeCount(clientRefCounts, row.client?.id);
      const agencyRefCount = safeCount(agencyRefCounts, row.agency?.id);
      const domainScore = row.nonFreeDomains.includes(group.dominantDomain) ? 50 : 0;
      const score =
        clientRefCount * 1000 +
        agencyRefCount * 100 +
        (row.taxId ? 40 : 0) +
        domainScore +
        row.linkedAgencyContacts.length * 10 -
        parseIso(row.client?.created_at) / 1_000_000_000_000;
      return { ...row, clientRefCount, agencyRefCount, score };
    });

    enriched.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return parseIso(a.client?.created_at) - parseIso(b.client?.created_at);
    });

    const canonical = enriched[0];
    const duplicates = enriched.slice(1);
    totals.safe_groups += 1;
    totals.duplicate_clients += duplicates.length;
    totals.duplicate_agencies += duplicates.length;

    const groupActions = [];
    const canonicalClientId = canonical.client.id;
    const canonicalAgencyId = canonical.agency.id;
    const canonicalContactId = txt(canonical.client.contact_id);
    const canonicalProfile = canonical.client.profile_data && typeof canonical.client.profile_data === "object"
      ? { ...canonical.client.profile_data }
      : {};
    const mergedImportKeys = new Set(getImportKeys(canonicalProfile));

    const reservationKeysOnCanonical = new Set(
      (clientMergeIndex.client_project_reservations.get(canonicalClientId) ?? []).map((row) =>
        `${row.project_property_id}|${row.source_file}|${row.source_row_number}`
      )
    );
    const propertyKeysOnCanonical = new Set(
      (clientMergeIndex.property_client_links.get(canonicalClientId) ?? []).map((row) => `${row.property_id}`)
    );
    const agencyContactKeysOnCanonical = new Set(
      (agencyMergeIndex.agency_contacts.get(canonicalAgencyId) ?? []).map((row) => `${row.contact_id}|${row.role}`)
    );

    for (const duplicate of duplicates) {
      const duplicateClientId = duplicate.client.id;
      const duplicateAgencyId = duplicate.agency.id;
      getImportKeys(duplicate.client?.profile_data).forEach((value) => mergedImportKeys.add(value));

      if ((providersByClientId.get(duplicateClientId) ?? []).length > 0) {
        groupReports.push({
          brand_key: group.brandKey,
          label: group.label,
          status: "blocked_provider",
          group_count: group.count,
          dominant_domain: group.dominantDomain ?? "",
          dominant_domain_count: group.dominantDomainCount,
          tax_ids: group.taxIds.join(" | "),
          canonical_agency_id: canonicalAgencyId,
          duplicate_agency_count: duplicates.length,
          action_count: 0,
        });
        continue;
      }

      for (const config of [
        { table: "leads", column: "converted_client_id", index: clientUpdateIndex.leads_converted_client_id },
        { table: "deals", column: "client_id", index: clientUpdateIndex.deals_client_id },
        { table: "activities", column: "client_id", index: clientUpdateIndex.activities_client_id },
        { table: "contracts", column: "client_id", index: clientUpdateIndex.contracts_client_id },
        { table: "invoices", column: "client_id", index: clientUpdateIndex.invoices_client_id },
        { table: "documents", column: "client_id", index: clientUpdateIndex.documents_client_id },
        { table: "portal_accounts", column: "client_id", index: clientUpdateIndex.portal_accounts_client_id },
      ]) {
        for (const ref of config.index.get(duplicateClientId) ?? []) {
          groupActions.push({
            type: "update",
            table: config.table,
            id: ref.id,
            patch: { [config.column]: canonicalClientId },
            brand_key: group.brandKey,
            label: group.label,
            canonical_agency_id: canonicalAgencyId,
            duplicate_agency_id: duplicateAgencyId,
            note: `${config.table}.${config.column}`,
          });
        }
      }

      for (const ref of clientMergeIndex.client_project_reservations.get(duplicateClientId) ?? []) {
        const key = `${ref.project_property_id}|${ref.source_file}|${ref.source_row_number}`;
        if (reservationKeysOnCanonical.has(key)) {
          groupActions.push({
            type: "delete",
            table: "client_project_reservations",
            id: ref.id,
            brand_key: group.brandKey,
            label: group.label,
            canonical_agency_id: canonicalAgencyId,
            duplicate_agency_id: duplicateAgencyId,
            note: "client_project_reservations.conflict_keep_canonical",
          });
        } else {
          reservationKeysOnCanonical.add(key);
          groupActions.push({
            type: "update",
            table: "client_project_reservations",
            id: ref.id,
            patch: { client_id: canonicalClientId },
            brand_key: group.brandKey,
            label: group.label,
            canonical_agency_id: canonicalAgencyId,
            duplicate_agency_id: duplicateAgencyId,
            note: "client_project_reservations.client_id",
          });
        }
      }

      for (const ref of clientMergeIndex.property_client_links.get(duplicateClientId) ?? []) {
        const key = `${ref.property_id}`;
        if (propertyKeysOnCanonical.has(key)) {
          groupActions.push({
            type: "delete",
            table: "property_client_links",
            id: ref.id,
            brand_key: group.brandKey,
            label: group.label,
            canonical_agency_id: canonicalAgencyId,
            duplicate_agency_id: duplicateAgencyId,
            note: "property_client_links.conflict_keep_canonical",
          });
        } else {
          propertyKeysOnCanonical.add(key);
          groupActions.push({
            type: "update",
            table: "property_client_links",
            id: ref.id,
            patch: { client_id: canonicalClientId },
            brand_key: group.brandKey,
            label: group.label,
            canonical_agency_id: canonicalAgencyId,
            duplicate_agency_id: duplicateAgencyId,
            note: "property_client_links.client_id",
          });
        }
      }

      for (const config of [
        { table: "leads", column: "agency_id", index: agencyUpdateIndex.leads_agency_id },
        { table: "leads", column: "converted_agency_id", index: agencyUpdateIndex.leads_converted_agency_id },
        { table: "portal_accounts", column: "agency_id", index: agencyUpdateIndex.portal_accounts_agency_id },
        { table: "agencies", column: "parent_agency_id", index: agencyUpdateIndex.agencies_parent_agency_id },
      ]) {
        for (const ref of config.index.get(duplicateAgencyId) ?? []) {
          groupActions.push({
            type: "update",
            table: config.table,
            id: ref.id,
            patch: { [config.column]: canonicalAgencyId },
            brand_key: group.brandKey,
            label: group.label,
            canonical_agency_id: canonicalAgencyId,
            duplicate_agency_id: duplicateAgencyId,
            note: `${config.table}.${config.column}`,
          });
        }
      }

      const duplicateBaseContactId = txt(duplicate.client.contact_id);
      if (duplicateBaseContactId && duplicateBaseContactId !== canonicalContactId) {
        const key = `${duplicateBaseContactId}|agent`;
        if (!agencyContactKeysOnCanonical.has(key)) {
          agencyContactKeysOnCanonical.add(key);
          groupActions.push({
            type: "create",
            table: "agency_contacts",
            id: "",
            payload: {
              organization_id: ORGANIZATION_ID,
              agency_id: canonicalAgencyId,
              contact_id: duplicateBaseContactId,
              role: "agent",
              relation_status: "active",
              is_primary: false,
              notes: `Merged from brand group ${group.label}`,
            },
            brand_key: group.brandKey,
            label: group.label,
            canonical_agency_id: canonicalAgencyId,
            duplicate_agency_id: duplicateAgencyId,
            note: "agency_contacts.create_from_duplicate_base_contact",
          });
        }
      }

      for (const ref of agencyMergeIndex.agency_contacts.get(duplicateAgencyId) ?? []) {
        const key = `${ref.contact_id}|${ref.role}`;
        if (agencyContactKeysOnCanonical.has(key)) {
          groupActions.push({
            type: "delete",
            table: "agency_contacts",
            id: ref.id,
            brand_key: group.brandKey,
            label: group.label,
            canonical_agency_id: canonicalAgencyId,
            duplicate_agency_id: duplicateAgencyId,
            note: "agency_contacts.conflict_keep_canonical",
          });
        } else {
          agencyContactKeysOnCanonical.add(key);
          groupActions.push({
            type: "update",
            table: "agency_contacts",
            id: ref.id,
            patch: { agency_id: canonicalAgencyId },
            brand_key: group.brandKey,
            label: group.label,
            canonical_agency_id: canonicalAgencyId,
            duplicate_agency_id: duplicateAgencyId,
            note: "agency_contacts.agency_id",
          });
        }
      }

      groupActions.push({
        type: "delete",
        table: "agencies",
        id: duplicateAgencyId,
        brand_key: group.brandKey,
        label: group.label,
        canonical_agency_id: canonicalAgencyId,
        duplicate_agency_id: duplicateAgencyId,
        note: "delete_duplicate_agency",
      });
      groupActions.push({
        type: "delete",
        table: "clients",
        id: duplicateClientId,
        brand_key: group.brandKey,
        label: group.label,
        canonical_agency_id: canonicalAgencyId,
        duplicate_agency_id: duplicateAgencyId,
        note: "delete_duplicate_client",
      });
    }

    const mergedImportKeyList = [...mergedImportKeys];
    if (mergedImportKeyList.length) {
      const nextProfile = { ...canonicalProfile };
      if (!txt(nextProfile.import_source_key)) nextProfile.import_source_key = mergedImportKeyList[0];
      nextProfile.import_source_keys = mergedImportKeyList;
      if (JSON.stringify(nextProfile) !== JSON.stringify(canonicalProfile)) {
        groupActions.unshift({
          type: "update",
          table: "clients",
          id: canonicalClientId,
          patch: { profile_data: nextProfile },
          brand_key: group.brandKey,
          label: group.label,
          canonical_agency_id: canonicalAgencyId,
          duplicate_agency_id: "",
          note: "clients.profile_data.import_source_keys",
        });
      }
    }

    actions.push(...groupActions);
    groupReports.push({
      brand_key: group.brandKey,
      label: group.label,
      status: "safe",
      group_count: group.count,
      dominant_domain: group.dominantDomain ?? "",
      dominant_domain_count: group.dominantDomainCount,
      tax_ids: group.taxIds.join(" | "),
      canonical_agency_id: canonicalAgencyId,
      duplicate_agency_count: duplicates.length,
      action_count: groupActions.length,
    });
  }

  if (APPLY) {
    for (const action of actions) {
      if (action.type === "update") {
        await updateRef(action.table, action.id, action.patch);
      } else if (action.type === "delete") {
        await deleteRef(action.table, action.id);
      } else if (action.type === "create") {
        await insertAgencyContact(action.payload);
      }
    }
  }

  totals.rows_updated = actions.filter((row) => row.type === "update").length;
  totals.rows_deleted = actions.filter((row) => row.type === "delete").length;
  totals.rows_inserted = actions.filter((row) => row.type === "create").length;

  const runTs = timestamp();
  const groupsCsv = path.join(REPORTS_DIR, `agency-brand-merge-groups-${runTs}.csv`);
  const actionsCsv = path.join(REPORTS_DIR, `agency-brand-merge-actions-${runTs}.csv`);
  const reportJson = path.join(REPORTS_DIR, `agency-brand-merge-${runTs}.json`);

  writeCsv(groupsCsv, groupReports, [
    "brand_key",
    "label",
    "status",
    "group_count",
    "dominant_domain",
    "dominant_domain_count",
    "tax_ids",
    "canonical_agency_id",
    "duplicate_agency_count",
    "action_count",
  ]);
  writeCsv(actionsCsv, actions, [
    "type",
    "table",
    "id",
    "brand_key",
    "label",
    "canonical_agency_id",
    "duplicate_agency_id",
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
