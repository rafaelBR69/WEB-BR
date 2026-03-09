import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  ROOT,
  arg,
  parseEnvFile,
  relativeFromRoot,
  timestamp,
  txt,
  writeCsv,
  writeJson,
} from "./agency-import/shared.mjs";

const REFERENCE_DIR = path.join(ROOT, "scripts", "agency-import", "reference");
const REPORTS_DIR = path.join(ROOT, "scripts", "agency-import", "reports");
const PAGE_SIZE = 1000;

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

const ORGANIZATION_ID = txt(arg("organization-id")) ?? env("CRM_ORGANIZATION_ID") ?? env("PUBLIC_CRM_ORGANIZATION_ID");
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
    const { data, error } = await db
      .schema("crm")
      .from(table)
      .select(select)
      .eq("organization_id", ORGANIZATION_ID)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`db_${table}_read_error:${error.message}`);
    const chunk = Array.isArray(data) ? data : [];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
};

const asProfile = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

const main = async () => {
  const [agencies, clients, contacts, agencyContacts] = await Promise.all([
    fetchAllRows("agencies", "id, client_id, agency_code, agency_status, agency_scope, notes"),
    fetchAllRows("clients", "id, contact_id, billing_name, tax_id, profile_data, client_code"),
    fetchAllRows("contacts", "id, full_name, email, phone"),
    fetchAllRows("agency_contacts", "id, agency_id, contact_id, role, relation_status"),
  ]);

  const clientById = new Map(clients.map((row) => [txt(row.id), row]));
  const contactById = new Map(contacts.map((row) => [txt(row.id), row]));
  const agencyContactsByAgencyId = new Map();

  agencyContacts.forEach((row) => {
    if ((txt(row.relation_status) ?? "active") !== "active") return;
    const agencyId = txt(row.agency_id);
    if (!agencyId) return;
    const current = agencyContactsByAgencyId.get(agencyId) ?? [];
    current.push(row);
    agencyContactsByAgencyId.set(agencyId, current);
  });

  const rows = [];

  agencies.forEach((agency) => {
    const agencyId = txt(agency.id);
    const client = clientById.get(txt(agency.client_id)) ?? null;
    if (!agencyId || !client) return;
    const profile = asProfile(client.profile_data);
    const baseContact = contactById.get(txt(client.contact_id)) ?? null;
    const linkedAgencyContacts = agencyContactsByAgencyId.get(agencyId) ?? [];

    rows.push({
      dedupe_key: txt(profile.import_source_key) ?? `crm_agency:${agencyId}`,
      project_label: txt(profile.import_project_label) ?? "",
      project_legacy_code: txt(profile.import_project_legacy_code) ?? "",
      source_file: "crm_export",
      source_row_number: "",
      agency_name: txt(profile.agency_name) ?? txt(client.billing_name) ?? txt(agency.agency_code) ?? "",
      agent_name: txt(profile.agent_name) ?? txt(baseContact?.full_name) ?? "",
      email: txt(baseContact?.email) ?? "",
      phone: txt(baseContact?.phone) ?? "",
      tax_id: txt(client.tax_id) ?? "",
      base_contact_id: txt(baseContact?.id) ?? "",
      client_id: txt(client.id) ?? "",
      agency_id: agencyId,
      agency_code: txt(agency.agency_code) ?? "",
      agency_contact_id: "",
      role: "base",
    });

    linkedAgencyContacts.forEach((agencyContact) => {
      const contact = contactById.get(txt(agencyContact.contact_id)) ?? null;
      rows.push({
        dedupe_key: `${txt(profile.import_source_key) ?? `crm_agency:${agencyId}`}|agency_contact|${txt(agencyContact.id) ?? ""}`,
        project_label: txt(profile.import_project_label) ?? "",
        project_legacy_code: txt(profile.import_project_legacy_code) ?? "",
        source_file: "crm_export",
        source_row_number: "",
        agency_name: txt(profile.agency_name) ?? txt(client.billing_name) ?? txt(agency.agency_code) ?? "",
        agent_name: txt(contact?.full_name) ?? "",
        email: txt(contact?.email) ?? "",
        phone: txt(contact?.phone) ?? "",
        tax_id: txt(client.tax_id) ?? "",
        base_contact_id: txt(baseContact?.id) ?? "",
        client_id: txt(client.id) ?? "",
        agency_id: agencyId,
        agency_code: txt(agency.agency_code) ?? "",
        agency_contact_id: txt(agencyContact.id) ?? "",
        role: txt(agencyContact.role) ?? "agent",
      });
    });
  });

  const csvPath = path.join(REFERENCE_DIR, "agency-db-map-latest.csv");
  const jsonPath = path.join(REFERENCE_DIR, "agency-db-map-latest.json");
  const reportPath = path.join(REPORTS_DIR, `agency-db-map-export-${timestamp()}.json`);

  writeCsv(csvPath, rows, [
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
    "agency_code",
    "agency_contact_id",
    "role",
  ]);
  writeJson(jsonPath, rows);
  writeJson(reportPath, {
    generated_at: new Date().toISOString(),
    organization_id: ORGANIZATION_ID,
    totals: {
      agencies_total: agencies.length,
      rows_total: rows.length,
      agency_contacts_total: agencyContacts.length,
    },
    outputs: {
      agency_db_map_csv: relativeFromRoot(csvPath),
      agency_db_map_json: relativeFromRoot(jsonPath),
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        totals: {
          agencies_total: agencies.length,
          rows_total: rows.length,
        },
        outputs: {
          agency_db_map_csv: relativeFromRoot(csvPath),
          agency_db_map_json: relativeFromRoot(jsonPath),
          report_json: relativeFromRoot(reportPath),
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
