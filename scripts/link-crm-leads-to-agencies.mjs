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

const DEFAULT_REVIEW_CSV = path.join(ROOT, "scripts", "agency-import", "reference", "agency-lead-match-review-latest.csv");
const DEFAULT_DB_MAP_JSON = path.join(ROOT, "scripts", "agency-import", "reference", "agency-db-map-latest.json");
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
const resolveCliPath = (value, fallback) => {
  const selected = value ?? fallback;
  return path.isAbsolute(selected) ? selected : path.join(ROOT, selected);
};
const APPLY = flag("apply");
const ORGANIZATION_ID = txt(arg("organization-id")) ?? env("CRM_ORGANIZATION_ID");
const SUPABASE_URL = env("SUPABASE_URL") ?? env("PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const REVIEW_CSV = resolveCliPath(arg("review-csv"), DEFAULT_REVIEW_CSV);
const DB_MAP_JSON = resolveCliPath(arg("db-map-json"), DEFAULT_DB_MAP_JSON);
const MATCH_STATUS = txt(arg("match-status")) ?? "exact";

if (!ORGANIZATION_ID) throw new Error("organization_id_required");
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("supabase_credentials_required");
if (!fs.existsSync(REVIEW_CSV)) throw new Error(`review_csv_not_found:${REVIEW_CSV}`);
if (!fs.existsSync(DB_MAP_JSON)) throw new Error(`db_map_json_not_found:${DB_MAP_JSON}`);

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const PAGE_SIZE = 1000;

const parseCsv = (filePath) => {
  const text = fs.readFileSync(filePath, "utf8");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
  }
  row.push(field);
  if (row.some((entry) => String(entry ?? "").length > 0)) rows.push(row);
  const [header = [], ...body] = rows;
  return body.map((current) =>
    header.reduce((acc, key, index) => {
      acc[key] = current[index] ?? "";
      return acc;
    }, {})
  );
};

const normalizeImportFileName = (value) => {
  const text = txt(value);
  if (!text) return null;
  return path.basename(text.replace(/\\/g, "/"));
};

const splitMulti = (value) =>
  String(value ?? "")
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);

const buildImportKey = (sourceFile, sourceRowNumber) => {
  const file = normalizeImportFileName(sourceFile);
  const row = Number(sourceRowNumber);
  if (!file || !Number.isFinite(row) || row <= 0) return null;
  return `${file}|${row}`;
};

const fetchLeads = async () => {
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await db
      .schema("crm")
      .from("leads")
      .select("id, organization_id, agency_id, provider_id, origin_type, raw_payload")
      .eq("organization_id", ORGANIZATION_ID)
      .range(from, to);
    if (error) throw new Error(`db_leads_read_error:${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
};

const leadsByImportKey = new Map();
const addLeadIndex = (lead) => {
  const importMeta = lead?.raw_payload?.import ?? {};
  const key = buildImportKey(importMeta.source_file, importMeta.source_row_number);
  if (!key) return;
  leadsByImportKey.set(key, lead);
};

const main = async () => {
  const reviewRows = parseCsv(REVIEW_CSV).filter((row) => String(row.match_status || "").trim() === MATCH_STATUS);
  const dbMapRows = readJson(DB_MAP_JSON);
  const agencyIdByDedupeKey = new Map(
    dbMapRows
      .map((row) => [txt(row.dedupe_key), txt(row.agency_id)])
      .filter((entry) => entry[0] && entry[1])
  );
  const agencyIdBySourceKey = new Map(
    dbMapRows
      .map((row) => [buildImportKey(row.source_file, row.source_row_number), txt(row.agency_id)])
      .filter((entry) => entry[0] && entry[1])
  );

  const leads = await fetchLeads();
  leads.forEach(addLeadIndex);

  const actions = [];
  let leadsLinked = 0;
  let leadsAlreadyLinked = 0;
  let leadsMissing = 0;
  let leadsConflict = 0;
  let agenciesMissing = 0;

  for (const row of reviewRows) {
    const agencyDedupeKey = txt(row.agency_dedupe_key);
    const agencySourceKey = buildImportKey(row.agency_source_file, row.agency_source_row_number);
    const agencyId =
      (agencyDedupeKey ? agencyIdByDedupeKey.get(agencyDedupeKey) ?? null : null) ??
      (agencySourceKey ? agencyIdBySourceKey.get(agencySourceKey) ?? null : null);
    const sourceFiles = splitMulti(row.lead_source_file);
    const sourceRows = splitMulti(row.lead_source_row_number);

    if (!agencyId) {
      agenciesMissing += 1;
      actions.push({
        status: "agency_missing_in_db_map",
        agency_dedupe_key: agencyDedupeKey ?? "",
        agency_source_file: row.agency_source_file ?? "",
        agency_source_row_number: row.agency_source_row_number ?? "",
        agency_name: row.agency_name ?? "",
        lead_agency_name: row.lead_agency_name ?? "",
        lead_source_file: row.lead_source_file ?? "",
        lead_source_row_number: row.lead_source_row_number ?? "",
        lead_id: "",
        agency_id: "",
      });
      continue;
    }

    for (let i = 0; i < Math.max(sourceFiles.length, sourceRows.length); i += 1) {
      const importKey = buildImportKey(sourceFiles[i], sourceRows[i]);
      const lead = importKey ? leadsByImportKey.get(importKey) ?? null : null;
      if (!lead) {
        leadsMissing += 1;
        actions.push({
          status: "lead_not_found",
          agency_dedupe_key: agencyDedupeKey ?? "",
          agency_source_file: row.agency_source_file ?? "",
          agency_source_row_number: row.agency_source_row_number ?? "",
          agency_name: row.agency_name ?? "",
          lead_agency_name: row.lead_agency_name ?? "",
          lead_source_file: sourceFiles[i] ?? "",
          lead_source_row_number: sourceRows[i] ?? "",
          lead_id: "",
          agency_id: agencyId,
        });
        continue;
      }

      if (txt(lead.agency_id) && txt(lead.agency_id) === agencyId) {
        leadsAlreadyLinked += 1;
        actions.push({
          status: "already_linked",
          agency_dedupe_key: agencyDedupeKey ?? "",
          agency_source_file: row.agency_source_file ?? "",
          agency_source_row_number: row.agency_source_row_number ?? "",
          agency_name: row.agency_name ?? "",
          lead_agency_name: row.lead_agency_name ?? "",
          lead_source_file: sourceFiles[i] ?? "",
          lead_source_row_number: sourceRows[i] ?? "",
          lead_id: lead.id,
          agency_id: agencyId,
        });
        continue;
      }

      if (txt(lead.agency_id) && txt(lead.agency_id) !== agencyId) {
        leadsConflict += 1;
        actions.push({
          status: "lead_has_different_agency",
          agency_dedupe_key: agencyDedupeKey ?? "",
          agency_source_file: row.agency_source_file ?? "",
          agency_source_row_number: row.agency_source_row_number ?? "",
          agency_name: row.agency_name ?? "",
          lead_agency_name: row.lead_agency_name ?? "",
          lead_source_file: sourceFiles[i] ?? "",
          lead_source_row_number: sourceRows[i] ?? "",
          lead_id: lead.id,
          agency_id: agencyId,
        });
        continue;
      }

      const nextRawPayload = {
        ...(lead.raw_payload ?? {}),
        agency_match: {
          matched_at: new Date().toISOString(),
          match_status: MATCH_STATUS,
          agency_dedupe_key: agencyDedupeKey,
          agency_source_file: row.agency_source_file ?? null,
          agency_source_row_number: row.agency_source_row_number ?? null,
          agency_name: row.agency_name ?? null,
          lead_agency_name: row.lead_agency_name ?? null,
          lead_source_file: sourceFiles[i] ?? null,
          lead_source_row_number: sourceRows[i] ?? null,
        },
      };

      if (APPLY) {
        const patch = {
          agency_id: agencyId,
          origin_type: txt(lead.provider_id) ? txt(lead.origin_type) ?? "other" : "agency",
          raw_payload: nextRawPayload,
        };
        const { error } = await db
          .schema("crm")
          .from("leads")
          .update(patch)
          .eq("organization_id", ORGANIZATION_ID)
          .eq("id", lead.id);
        if (error) throw new Error(`db_lead_update_error:${error.message}`);
      }

      leadsLinked += 1;
      actions.push({
        status: APPLY ? "linked" : "would_link",
        agency_dedupe_key: agencyDedupeKey ?? "",
        agency_source_file: row.agency_source_file ?? "",
        agency_source_row_number: row.agency_source_row_number ?? "",
        agency_name: row.agency_name ?? "",
        lead_agency_name: row.lead_agency_name ?? "",
        lead_source_file: sourceFiles[i] ?? "",
        lead_source_row_number: sourceRows[i] ?? "",
        lead_id: lead.id,
        agency_id: agencyId,
      });
    }
  }

  const runTs = timestamp();
  const actionsCsv = path.join(REPORTS_DIR, `agency-lead-link-actions-${runTs}.csv`);
  const reportJson = path.join(REPORTS_DIR, `agency-lead-link-${runTs}.json`);

  writeCsv(actionsCsv, actions, [
    "status",
    "agency_dedupe_key",
    "agency_source_file",
    "agency_source_row_number",
    "agency_name",
    "lead_agency_name",
    "lead_source_file",
    "lead_source_row_number",
    "lead_id",
    "agency_id",
  ]);
  writeJson(reportJson, {
    generated_at: new Date().toISOString(),
    apply: APPLY,
    organization_id: ORGANIZATION_ID,
    review_csv: relativeFromRoot(REVIEW_CSV),
    db_map_json: relativeFromRoot(DB_MAP_JSON),
    match_status: MATCH_STATUS,
    totals: {
      review_rows: reviewRows.length,
      leads_linked: leadsLinked,
      leads_already_linked: leadsAlreadyLinked,
      leads_missing: leadsMissing,
      leads_conflict: leadsConflict,
      agencies_missing_in_db_map: agenciesMissing,
    },
    outputs: {
      actions_csv: relativeFromRoot(actionsCsv),
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        apply: APPLY,
        match_status: MATCH_STATUS,
        totals: {
          review_rows: reviewRows.length,
          leads_linked: leadsLinked,
          leads_already_linked: leadsAlreadyLinked,
          leads_missing: leadsMissing,
          leads_conflict: leadsConflict,
          agencies_missing_in_db_map: agenciesMissing,
        },
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
