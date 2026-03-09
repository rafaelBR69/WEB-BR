import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  ROOT,
  arg,
  parseEnvFile,
  readJson,
  relativeFromRoot,
  timestamp,
  txt,
  writeCsv,
  writeJson,
} from "./agency-import/shared.mjs";

const DEFAULT_DB_MAP_JSON = path.join(ROOT, "scripts", "agency-import", "reference", "agency-db-map-latest.json");
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

const resolveCliPath = (value, fallback) => {
  const selected = value ?? fallback;
  return path.isAbsolute(selected) ? selected : path.join(ROOT, selected);
};

const ORGANIZATION_ID = txt(arg("organization-id")) ?? env("CRM_ORGANIZATION_ID");
const SUPABASE_URL = env("SUPABASE_URL") ?? env("PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const DB_MAP_JSON = resolveCliPath(arg("db-map-json"), DEFAULT_DB_MAP_JSON);

if (!ORGANIZATION_ID) throw new Error("organization_id_required");
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("supabase_credentials_required");
if (!fs.existsSync(DB_MAP_JSON)) throw new Error(`db_map_json_not_found:${DB_MAP_JSON}`);

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

const uniq = (values) => [...new Set(values.filter(Boolean))];

const asProfile = (value) => (value && typeof value === "object" ? value : {});

const getPropertyDisplayName = (row) => {
  const propertyData = row?.property_data && typeof row.property_data === "object" ? row.property_data : {};
  const translations = row?.translations && typeof row.translations === "object" ? row.translations : {};
  const preferredLanguages = ["es", "en", "de", "fr", "it", "nl"];
  for (const language of preferredLanguages) {
    const scoped = translations[language];
    if (scoped && typeof scoped === "object") {
      const title = txt(scoped.title) ?? txt(scoped.name);
      if (title) return title;
    }
  }
  return (
    txt(propertyData.display_name) ??
    txt(propertyData.project_name) ??
    txt(propertyData.promotion_name) ??
    txt(propertyData.commercial_name) ??
    txt(propertyData.name) ??
    txt(propertyData.title) ??
    txt(row.legacy_code)
  );
};

const main = async () => {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const [dbMapRows, agencies, clients, properties, leads, reservations] = await Promise.all([
    readJson(DB_MAP_JSON),
    fetchAllRows("agencies", "id, organization_id, client_id, agency_code"),
    fetchAllRows("clients", "id, organization_id, billing_name, profile_data"),
    fetchAllRows("properties", "id, organization_id, legacy_code, record_type, property_data, translations"),
    fetchAllRows("leads", "id, organization_id, agency_id, property_id, raw_payload"),
    fetchAllRows("client_project_reservations", "id, organization_id, client_id, project_property_id, agency_name, agency_contact, agent_name"),
  ]);

  const clientById = new Map(clients.map((row) => [txt(row.id), row]));
  const propertyById = new Map(properties.map((row) => [txt(row.id), row]));

  const links = new Map();

  const addEvidence = ({ agencyId, projectId, projectLegacyCode, projectLabel, evidenceType, referenceId, weight }) => {
    const safeAgencyId = txt(agencyId);
    const safeProjectId = txt(projectId) ?? `legacy:${txt(projectLegacyCode) ?? txt(projectLabel) ?? "unknown"}`;
    if (!safeAgencyId || !safeProjectId) return;
    const key = `${safeAgencyId}|${safeProjectId}`;
    const current = links.get(key) ?? {
      agency_id: safeAgencyId,
      project_id: txt(projectId) ?? "",
      project_legacy_code: txt(projectLegacyCode) ?? "",
      project_label: txt(projectLabel) ?? "",
      evidence_types: new Set(),
      evidence_refs: new Set(),
      import_rows: 0,
      leads_count: 0,
      reservations_count: 0,
      linked_clients_count: 0,
      score: 0,
    };

    if (evidenceType === "import_source") current.import_rows += 1;
    if (evidenceType === "lead") current.leads_count += 1;
    if (evidenceType === "reservation_client_link") current.reservations_count += 1;
    if (evidenceType === "reservation_client_link") current.linked_clients_count += 1;

    current.evidence_types.add(evidenceType);
    if (referenceId) current.evidence_refs.add(referenceId);
    current.score += weight;
    if (!current.project_legacy_code && txt(projectLegacyCode)) current.project_legacy_code = txt(projectLegacyCode);
    if (!current.project_label && txt(projectLabel)) current.project_label = txt(projectLabel);
    if (!current.project_id && txt(projectId)) current.project_id = txt(projectId);
    links.set(key, current);
  };

  for (const row of dbMapRows) {
    addEvidence({
      agencyId: row.agency_id,
      projectId: "",
      projectLegacyCode: row.project_legacy_code,
      projectLabel: row.project_label,
      evidenceType: "import_source",
      referenceId: txt(row.dedupe_key) ?? `${txt(row.source_file)}#${txt(row.source_row_number)}`,
      weight: 3,
    });
  }

  for (const lead of leads) {
    const agencyId = txt(lead.agency_id);
    const propertyId = txt(lead.property_id);
    if (!agencyId || !propertyId) continue;
    const property = propertyById.get(propertyId) ?? null;
    addEvidence({
      agencyId,
      projectId: propertyId,
      projectLegacyCode: txt(property?.legacy_code),
      projectLabel: getPropertyDisplayName(property),
      evidenceType: "lead",
      referenceId: txt(lead.id),
      weight: 6,
    });
  }

  for (const reservation of reservations) {
    const client = clientById.get(txt(reservation.client_id)) ?? null;
    const profile = asProfile(client?.profile_data);
    const agencyId = txt(profile.linked_agency_id);
    const projectId = txt(reservation.project_property_id);
    if (!agencyId || !projectId) continue;
    const property = propertyById.get(projectId) ?? null;
    addEvidence({
      agencyId,
      projectId,
      projectLegacyCode: txt(property?.legacy_code),
      projectLabel: getPropertyDisplayName(property),
      evidenceType: "reservation_client_link",
      referenceId: txt(reservation.id),
      weight: 8,
    });
  }

  const rows = agencies
    .map((agency) => {
      const client = clientById.get(txt(agency.client_id)) ?? null;
      const profile = asProfile(client?.profile_data);
      const agencyName =
        txt(client?.billing_name) ??
        txt(profile.agency_name) ??
        txt(profile.agent_name) ??
        txt(agency.agency_code) ??
        "Agencia";

      const agencyLinks = [...links.values()].filter((row) => row.agency_id === txt(agency.id));
      return agencyLinks.map((row) => {
        const evidenceTypes = [...row.evidence_types];
        const confidence =
          row.reservations_count > 0 || (row.leads_count > 0 && row.import_rows > 0)
            ? "high"
            : row.leads_count > 0 || row.import_rows > 1
              ? "medium"
              : "low";
        return {
          agency_id: txt(agency.id) ?? "",
          agency_code: txt(agency.agency_code) ?? "",
          agency_name: agencyName,
          project_id: row.project_id,
          project_legacy_code: row.project_legacy_code,
          project_label: row.project_label,
          confidence,
          score: row.score,
          import_rows: row.import_rows,
          leads_count: row.leads_count,
          reservations_count: row.reservations_count,
          linked_clients_count: row.linked_clients_count,
          evidence_types: evidenceTypes.join(" | "),
          evidence_refs_count: row.evidence_refs.size,
        };
      });
    })
    .flat()
    .sort((a, b) => {
      return String(a.agency_name).localeCompare(String(b.agency_name), "es") ||
        String(a.project_label).localeCompare(String(b.project_label), "es") ||
        Number(b.score) - Number(a.score);
    });

  const runTs = timestamp();
  const csvPath = path.join(REPORTS_DIR, `agency-project-links-${runTs}.csv`);
  const jsonPath = path.join(REPORTS_DIR, `agency-project-links-${runTs}.json`);

  writeCsv(csvPath, rows, [
    "agency_id",
    "agency_code",
    "agency_name",
    "project_id",
    "project_legacy_code",
    "project_label",
    "confidence",
    "score",
    "import_rows",
    "leads_count",
    "reservations_count",
    "linked_clients_count",
    "evidence_types",
    "evidence_refs_count",
  ]);

  writeJson(jsonPath, {
    generated_at: new Date().toISOString(),
    organization_id: ORGANIZATION_ID,
    db_map_json: relativeFromRoot(DB_MAP_JSON),
    totals: {
      agencies_total: agencies.length,
      linked_rows: rows.length,
      agencies_with_any_project: uniq(rows.map((row) => row.agency_id)).length,
      high_confidence: rows.filter((row) => row.confidence === "high").length,
      medium_confidence: rows.filter((row) => row.confidence === "medium").length,
      low_confidence: rows.filter((row) => row.confidence === "low").length,
    },
    outputs: {
      csv: relativeFromRoot(csvPath),
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        totals: {
          agencies_total: agencies.length,
          linked_rows: rows.length,
          agencies_with_any_project: uniq(rows.map((row) => row.agency_id)).length,
          high_confidence: rows.filter((row) => row.confidence === "high").length,
          medium_confidence: rows.filter((row) => row.confidence === "medium").length,
          low_confidence: rows.filter((row) => row.confidence === "low").length,
        },
        outputs: {
          csv: relativeFromRoot(csvPath),
          report_json: relativeFromRoot(jsonPath),
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
