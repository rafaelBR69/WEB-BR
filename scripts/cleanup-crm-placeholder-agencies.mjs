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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const deleteRow = async (table, id) => {
  let lastError = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const { error } = await db
      .schema("crm")
      .from(table)
      .delete()
      .eq("organization_id", ORGANIZATION_ID)
      .eq("id", id);
    if (!error) return;
    lastError = error;
    const message = String(error.message ?? "");
    const retryable =
      message.includes("502") || message.includes("Bad gateway") || message.includes("fetch failed");
    if (!retryable || attempt === 6) break;
    await sleep(attempt * 500);
  }
  throw new Error(`db_${table}_delete_error:${lastError?.message ?? "unknown"}`);
};

const isPlaceholderClient = (client) => {
  const billingName = txt(client.billing_name);
  const profile = client.profile_data && typeof client.profile_data === "object" ? client.profile_data : {};
  const agencyName = txt(profile.agency_name);
  const agentName = txt(profile.agent_name);
  return Boolean(billingName?.startsWith("Agency ") && !agencyName && !agentName);
};

const main = async () => {
  ensureDir(REPORTS_DIR);

  const [clients, agencies, leads, agencyContacts, reservations, propertyLinks] = await Promise.all([
    fetchAllRows("clients", "id, contact_id, billing_name, profile_data"),
    fetchAllRows("agencies", "id, client_id, agency_code"),
    fetchAllRows("leads", "id, agency_id, converted_agency_id, converted_client_id"),
    fetchAllRows("agency_contacts", "id, agency_id"),
    fetchAllRows("client_project_reservations", "id, client_id"),
    fetchAllRows("property_client_links", "id, client_id"),
  ]);

  const placeholderClients = clients.filter(isPlaceholderClient);
  const placeholderClientIds = new Set(placeholderClients.map((row) => row.id));
  const placeholderAgencies = agencies.filter((row) => placeholderClientIds.has(row.client_id));
  const placeholderAgencyIds = new Set(placeholderAgencies.map((row) => row.id));

  const blockers = [];
  if (leads.some((row) => txt(row.agency_id) && placeholderAgencyIds.has(row.agency_id))) blockers.push("leads.agency_id");
  if (leads.some((row) => txt(row.converted_agency_id) && placeholderAgencyIds.has(row.converted_agency_id)))
    blockers.push("leads.converted_agency_id");
  if (leads.some((row) => txt(row.converted_client_id) && placeholderClientIds.has(row.converted_client_id)))
    blockers.push("leads.converted_client_id");
  if (agencyContacts.some((row) => txt(row.agency_id) && placeholderAgencyIds.has(row.agency_id)))
    blockers.push("agency_contacts.agency_id");
  if (reservations.some((row) => txt(row.client_id) && placeholderClientIds.has(row.client_id)))
    blockers.push("client_project_reservations.client_id");
  if (propertyLinks.some((row) => txt(row.client_id) && placeholderClientIds.has(row.client_id)))
    blockers.push("property_client_links.client_id");

  const actions = [];
  for (const agency of placeholderAgencies) {
    actions.push({
      type: "delete",
      table: "agencies",
      id: agency.id,
      client_id: agency.client_id,
      billing_name: placeholderClients.find((row) => row.id === agency.client_id)?.billing_name ?? "",
      agency_code: agency.agency_code ?? "",
    });
  }
  for (const client of placeholderClients) {
    actions.push({
      type: "delete",
      table: "clients",
      id: client.id,
      client_id: client.id,
      billing_name: client.billing_name ?? "",
      agency_code: "",
    });
  }

  if (APPLY && blockers.length) {
    throw new Error(`placeholder_cleanup_blocked:${blockers.join("|")}`);
  }

  if (APPLY) {
    for (const agency of placeholderAgencies) {
      await deleteRow("agencies", agency.id);
    }
    for (const client of placeholderClients) {
      await deleteRow("clients", client.id);
    }
  }

  const runTs = timestamp();
  const actionsCsv = path.join(REPORTS_DIR, `agency-placeholder-cleanup-actions-${runTs}.csv`);
  const reportJson = path.join(REPORTS_DIR, `agency-placeholder-cleanup-${runTs}.json`);

  writeCsv(actionsCsv, actions, ["type", "table", "id", "client_id", "billing_name", "agency_code"]);
  writeJson(reportJson, {
    generated_at: new Date().toISOString(),
    apply: APPLY,
    organization_id: ORGANIZATION_ID,
    totals: {
      placeholder_clients: placeholderClients.length,
      placeholder_agencies: placeholderAgencies.length,
      blockers: blockers.length,
    },
    blockers,
    outputs: {
      actions_csv: relativeFromRoot(actionsCsv),
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        apply: APPLY,
        organization_id: ORGANIZATION_ID,
        totals: {
          placeholder_clients: placeholderClients.length,
          placeholder_agencies: placeholderAgencies.length,
          blockers: blockers.length,
        },
        blockers,
        outputs: {
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
