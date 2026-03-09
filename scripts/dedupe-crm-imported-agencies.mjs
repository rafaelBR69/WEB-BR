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

const CLIENT_UPDATE_TABLES = [
  { table: "leads", id: "id", column: "converted_client_id" },
  { table: "deals", id: "id", column: "client_id" },
  { table: "activities", id: "id", column: "client_id" },
  { table: "contracts", id: "id", column: "client_id" },
  { table: "invoices", id: "id", column: "client_id" },
  { table: "documents", id: "id", column: "client_id" },
  { table: "portal_accounts", id: "id", column: "client_id" },
];

const CLIENT_MERGE_TABLES = [
  {
    table: "client_project_reservations",
    id: "id",
    column: "client_id",
    key: (row) => `${row.project_property_id}|${row.source_file}|${row.source_row_number}`,
    select: "id, client_id, project_property_id, source_file, source_row_number",
  },
  {
    table: "property_client_links",
    id: "id",
    column: "client_id",
    key: (row) => `${row.property_id}`,
    select: "id, client_id, property_id",
  },
];

const CLIENT_BLOCKER_TABLES = [{ table: "providers", id: "id", column: "client_id" }];

const AGENCY_UPDATE_TABLES = [
  { table: "leads", id: "id", column: "agency_id" },
  { table: "leads", id: "id", column: "converted_agency_id" },
  { table: "portal_accounts", id: "id", column: "agency_id" },
  { table: "agencies", id: "id", column: "parent_agency_id" },
];

const AGENCY_MERGE_TABLES = [
  {
    table: "agency_contacts",
    id: "id",
    column: "agency_id",
    key: (row) => `${row.contact_id}|${row.role}`,
    select: "id, agency_id, contact_id, role",
  },
];

const parseIso = (value) => {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
};

const getImportKey = (client) => {
  const profile = client.profile_data && typeof client.profile_data === "object" ? client.profile_data : {};
  return txt(profile.import_source_key);
};

const countBy = (rows, keyName) => {
  const out = new Map();
  for (const row of rows) {
    const key = txt(row[keyName]);
    if (!key) continue;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
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

const main = async () => {
  ensureDir(REPORTS_DIR);

  const [
    clients,
    agencies,
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
    agencyContacts,
  ] = await Promise.all([
    fetchAllRows("clients", "id, contact_id, billing_name, tax_id, profile_data, created_at, updated_at"),
    fetchAllRows("agencies", "id, client_id, agency_status, created_at, updated_at"),
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
    fetchAllRows("agency_contacts", "id, agency_id, contact_id, role"),
  ]);

  const agencyByClientId = new Map(agencies.map((row) => [row.client_id, row]));
  const clientsWithImport = clients.filter((row) => getImportKey(row));
  const groups = groupBy(clientsWithImport, getImportKey);
  const duplicateGroups = [...groups.entries()].filter(([, rows]) => rows.length > 1);

  const clientRefCounts = new Map();
  const agencyRefCounts = new Map();
  const incrementCounts = (rows, keyName, map, extraKeyNames = []) => {
    for (const row of rows) {
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
  const providersByClientId = groupBy(providers, (row) => row.client_id);

  const groupReports = [];
  const actions = [];
  const totals = {
    duplicate_groups: duplicateGroups.length,
    duplicate_clients: 0,
    duplicate_agencies: 0,
    groups_safe: 0,
    groups_blocked: 0,
    rows_updated: 0,
    rows_deleted: 0,
    orphan_contacts_left: 0,
  };

  for (const [importKey, groupClients] of duplicateGroups) {
    const enriched = groupClients.map((client) => {
      const agency = agencyByClientId.get(client.id) ?? null;
      const clientRefCount = safeCount(clientRefCounts, client.id);
      const agencyRefCount = agency ? safeCount(agencyRefCounts, agency.id) : 0;
      const score =
        clientRefCount * 1000 +
        agencyRefCount * 100 +
        (txt(client.tax_id) ? 10 : 0) +
        (txt(client.contact_id) ? 5 : 0) -
        parseIso(client.created_at) / 1_000_000_000_000;
      return { client, agency, clientRefCount, agencyRefCount, score };
    });

    enriched.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return parseIso(a.client.created_at) - parseIso(b.client.created_at);
    });

    const canonical = enriched[0];
    const duplicates = enriched.slice(1);
    totals.duplicate_clients += duplicates.length;
    totals.duplicate_agencies += duplicates.filter((row) => row.agency?.id).length;

    const blockers = [];
    const groupActions = [];

    const canonicalClientId = canonical.client.id;
    const canonicalAgencyId = canonical.agency?.id ?? null;

    const reservationKeysOnCanonical = new Set(
      (clientMergeIndex.client_project_reservations.get(canonicalClientId) ?? []).map((row) =>
        `${row.project_property_id}|${row.source_file}|${row.source_row_number}`
      )
    );
    const propertyKeysOnCanonical = new Set(
      (clientMergeIndex.property_client_links.get(canonicalClientId) ?? []).map((row) => `${row.property_id}`)
    );
    const agencyContactKeysOnCanonical = new Set(
      canonicalAgencyId
        ? (agencyMergeIndex.agency_contacts.get(canonicalAgencyId) ?? []).map((row) => `${row.contact_id}|${row.role}`)
        : []
    );

    for (const duplicate of duplicates) {
      const duplicateClientId = duplicate.client.id;
      const duplicateAgencyId = duplicate.agency?.id ?? null;

      if ((providersByClientId.get(duplicateClientId) ?? []).length > 0) {
        blockers.push(`provider_refs:${duplicateClientId}`);
        continue;
      }

      for (const config of CLIENT_UPDATE_TABLES) {
        const indexKey = `${config.table}_${config.column}`;
        const refs = clientUpdateIndex[indexKey].get(duplicateClientId) ?? [];
        for (const ref of refs) {
          groupActions.push({
            type: "update",
            table: config.table,
            id: ref.id,
            patch: { [config.column]: canonicalClientId },
            import_key: importKey,
            canonical_client_id: canonicalClientId,
            duplicate_client_id: duplicateClientId,
            canonical_agency_id: canonicalAgencyId ?? "",
            duplicate_agency_id: duplicateAgencyId ?? "",
            note: `${config.table}.${config.column}`,
          });
        }
      }

      const reservationRefs = clientMergeIndex.client_project_reservations.get(duplicateClientId) ?? [];
      for (const ref of reservationRefs) {
        const key = `${ref.project_property_id}|${ref.source_file}|${ref.source_row_number}`;
        if (reservationKeysOnCanonical.has(key)) {
          groupActions.push({
            type: "delete",
            table: "client_project_reservations",
            id: ref.id,
            import_key: importKey,
            canonical_client_id: canonicalClientId,
            duplicate_client_id: duplicateClientId,
            canonical_agency_id: canonicalAgencyId ?? "",
            duplicate_agency_id: duplicateAgencyId ?? "",
            note: "client_project_reservations.conflict_keep_canonical",
          });
        } else {
          reservationKeysOnCanonical.add(key);
          groupActions.push({
            type: "update",
            table: "client_project_reservations",
            id: ref.id,
            patch: { client_id: canonicalClientId },
            import_key: importKey,
            canonical_client_id: canonicalClientId,
            duplicate_client_id: duplicateClientId,
            canonical_agency_id: canonicalAgencyId ?? "",
            duplicate_agency_id: duplicateAgencyId ?? "",
            note: "client_project_reservations.client_id",
          });
        }
      }

      const propertyRefs = clientMergeIndex.property_client_links.get(duplicateClientId) ?? [];
      for (const ref of propertyRefs) {
        const key = `${ref.property_id}`;
        if (propertyKeysOnCanonical.has(key)) {
          groupActions.push({
            type: "delete",
            table: "property_client_links",
            id: ref.id,
            import_key: importKey,
            canonical_client_id: canonicalClientId,
            duplicate_client_id: duplicateClientId,
            canonical_agency_id: canonicalAgencyId ?? "",
            duplicate_agency_id: duplicateAgencyId ?? "",
            note: "property_client_links.conflict_keep_canonical",
          });
        } else {
          propertyKeysOnCanonical.add(key);
          groupActions.push({
            type: "update",
            table: "property_client_links",
            id: ref.id,
            patch: { client_id: canonicalClientId },
            import_key: importKey,
            canonical_client_id: canonicalClientId,
            duplicate_client_id: duplicateClientId,
            canonical_agency_id: canonicalAgencyId ?? "",
            duplicate_agency_id: duplicateAgencyId ?? "",
            note: "property_client_links.client_id",
          });
        }
      }

      if (duplicateAgencyId) {
        for (const config of AGENCY_UPDATE_TABLES) {
          const indexKey = `${config.table}_${config.column}`;
          const refs = agencyUpdateIndex[indexKey].get(duplicateAgencyId) ?? [];
          for (const ref of refs) {
            groupActions.push({
              type: "update",
              table: config.table,
              id: ref.id,
              patch: { [config.column]: canonicalAgencyId },
              import_key: importKey,
              canonical_client_id: canonicalClientId,
              duplicate_client_id: duplicateClientId,
              canonical_agency_id: canonicalAgencyId ?? "",
              duplicate_agency_id: duplicateAgencyId,
              note: `${config.table}.${config.column}`,
            });
          }
        }

        if (!canonicalAgencyId) {
          blockers.push(`canonical_agency_missing:${duplicateClientId}`);
        } else {
          const agencyContactRefs = agencyMergeIndex.agency_contacts.get(duplicateAgencyId) ?? [];
          for (const ref of agencyContactRefs) {
            const key = `${ref.contact_id}|${ref.role}`;
            if (agencyContactKeysOnCanonical.has(key)) {
              groupActions.push({
                type: "delete",
                table: "agency_contacts",
                id: ref.id,
                import_key: importKey,
                canonical_client_id: canonicalClientId,
                duplicate_client_id: duplicateClientId,
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
                import_key: importKey,
                canonical_client_id: canonicalClientId,
                duplicate_client_id: duplicateClientId,
                canonical_agency_id: canonicalAgencyId,
                duplicate_agency_id: duplicateAgencyId,
                note: "agency_contacts.agency_id",
              });
            }
          }
        }

        groupActions.push({
          type: "delete",
          table: "agencies",
          id: duplicateAgencyId,
          import_key: importKey,
          canonical_client_id: canonicalClientId,
          duplicate_client_id: duplicateClientId,
          canonical_agency_id: canonicalAgencyId ?? "",
          duplicate_agency_id: duplicateAgencyId,
          note: "delete_duplicate_agency",
        });
      }

      groupActions.push({
        type: "delete",
        table: "clients",
        id: duplicateClientId,
        import_key: importKey,
        canonical_client_id: canonicalClientId,
        duplicate_client_id: duplicateClientId,
        canonical_agency_id: canonicalAgencyId ?? "",
        duplicate_agency_id: duplicateAgencyId ?? "",
        note: "delete_duplicate_client",
      });
    }

    if (blockers.length > 0) {
      totals.groups_blocked += 1;
      groupReports.push({
        import_key: importKey,
        canonical_client_id: canonicalClientId,
        canonical_agency_id: canonicalAgencyId ?? "",
        duplicate_client_count: duplicates.length,
        duplicate_agency_count: duplicates.filter((row) => row.agency?.id).length,
        action_count: 0,
        blocker_count: blockers.length,
        blockers: blockers.join(" | "),
        status: "blocked",
      });
      continue;
    }

    totals.groups_safe += 1;
    actions.push(...groupActions);
    groupReports.push({
      import_key: importKey,
      canonical_client_id: canonicalClientId,
      canonical_agency_id: canonicalAgencyId ?? "",
      duplicate_client_count: duplicates.length,
      duplicate_agency_count: duplicates.filter((row) => row.agency?.id).length,
      action_count: groupActions.length,
      blocker_count: 0,
      blockers: "",
      status: "safe",
    });
  }

  if (APPLY) {
    for (const action of actions) {
      if (action.type === "update") {
        await updateRef(action.table, action.id, action.patch);
      } else {
        await deleteRef(action.table, action.id);
      }
    }
  }

  totals.rows_updated = actions.filter((row) => row.type === "update").length;
  totals.rows_deleted = actions.filter((row) => row.type === "delete").length;

  const runTs = timestamp();
  const actionsCsv = path.join(REPORTS_DIR, `agency-import-dedupe-actions-${runTs}.csv`);
  const groupsCsv = path.join(REPORTS_DIR, `agency-import-dedupe-groups-${runTs}.csv`);
  const reportJson = path.join(REPORTS_DIR, `agency-import-dedupe-${runTs}.json`);

  writeCsv(actionsCsv, actions, [
    "type",
    "table",
    "id",
    "import_key",
    "canonical_client_id",
    "duplicate_client_id",
    "canonical_agency_id",
    "duplicate_agency_id",
    "note",
  ]);
  writeCsv(groupsCsv, groupReports, [
    "import_key",
    "status",
    "canonical_client_id",
    "canonical_agency_id",
    "duplicate_client_count",
    "duplicate_agency_count",
    "action_count",
    "blocker_count",
    "blockers",
  ]);
  writeJson(reportJson, {
    generated_at: new Date().toISOString(),
    apply: APPLY,
    organization_id: ORGANIZATION_ID,
    totals,
    outputs: {
      actions_csv: relativeFromRoot(actionsCsv),
      groups_csv: relativeFromRoot(groupsCsv),
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
          actions_csv: relativeFromRoot(actionsCsv),
          groups_csv: relativeFromRoot(groupsCsv),
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
