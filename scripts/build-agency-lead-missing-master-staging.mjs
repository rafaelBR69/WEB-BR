import fs from "node:fs";
import path from "node:path";
import {
  ROOT,
  arg,
  buildLeadRecord,
  canonical,
  ensureDir,
  readCsvTable,
  readJson,
  relativeFromRoot,
  timestamp,
  txt,
  writeCsv,
  writeJson,
} from "./agency-import/shared.mjs";

const DEFAULT_JOB_FILE = path.join(ROOT, "scripts", "agency-import", "jobs", "default-agencies.json");
const DEFAULT_DB_MAP_JSON = path.join(ROOT, "scripts", "agency-import", "reference", "agency-db-map-latest.json");
const REFERENCE_DIR = path.join(ROOT, "scripts", "agency-import", "reference");
const REPORTS_DIR = path.join(ROOT, "scripts", "agency-import", "reports");

const resolveCliPath = (value, fallback) => {
  const selected = txt(value) ?? fallback;
  return path.isAbsolute(selected) ? selected : path.join(ROOT, selected);
};

const JOB_FILE = resolveCliPath(arg("job-file"), DEFAULT_JOB_FILE);
const DB_MAP_JSON = resolveCliPath(arg("db-map-json"), DEFAULT_DB_MAP_JSON);

const normalizeName = (value) => canonical(value).replace(/\s+/g, " ").trim() || null;
const isGenericAgencyName = (value) => {
  const normalized = normalizeName(value);
  if (!normalized) return true;
  return ["agencia", "autonomo", "autonoma", "autonom a", "independiente"].includes(normalized);
};

const loadLeadSources = (job) => {
  if (!Array.isArray(job.lead_sources) || !job.lead_sources.length) {
    throw new Error("agency_job_lead_sources_required");
  }
  return job.lead_sources.map((source) => {
    const file = txt(source.file);
    if (!file) throw new Error("lead_source_file_required");
    return {
      ...source,
      absolutePath: path.isAbsolute(file) ? file : path.join(ROOT, file),
    };
  });
};

const classifyStatus = (value) => {
  const normalized = normalizeName(value);
  if (!normalized) return "unknown";
  if (
    normalized.includes("cliente") ||
    normalized.includes("client") ||
    normalized.includes("customer") ||
    normalized.includes("convert") ||
    normalized.includes("compr") ||
    normalized.includes("reserv")
  ) {
    return "customer";
  }
  if (
    normalized.includes("baja") ||
    normalized.includes("descart") ||
    normalized.includes("lost") ||
    normalized.includes("perdid") ||
    normalized.includes("junk")
  ) {
    return "discarded";
  }
  return "active";
};

const reviewKeyFromLead = (lead) =>
  [txt(lead.project_label) ?? "", normalizeName(lead.agency_name) ?? "", normalizeName(lead.agent_name) ?? ""].join("|");

const buildIndexes = (rows) => {
  const indexes = {
    byProjectAgencyName: new Map(),
    byProjectAgencyAgent: new Map(),
    byAgencyName: new Map(),
    byAgencyAgent: new Map(),
  };

  const add = (map, key, agencyId) => {
    if (!key || !agencyId) return;
    const current = map.get(key) ?? new Set();
    current.add(agencyId);
    map.set(key, current);
  };

  rows.forEach((row) => {
    const agencyId = txt(row.agency_id);
    const project = txt(row.project_label) ?? "";
    const agencyName = normalizeName(row.agency_name);
    const agentName = normalizeName(row.agent_name);
    if (!agencyId) return;
    add(indexes.byProjectAgencyName, `${project}|${agencyName ?? ""}`, agencyId);
    add(indexes.byProjectAgencyAgent, `${project}|${agencyName ?? ""}|${agentName ?? ""}`, agencyId);
    add(indexes.byAgencyName, agencyName ?? "", agencyId);
    add(indexes.byAgencyAgent, `${agencyName ?? ""}|${agentName ?? ""}`, agencyId);
  });

  return indexes;
};

const findExistingAgencyId = (lead, indexes) => {
  const project = txt(lead.project_label) ?? "";
  const agencyName = normalizeName(lead.agency_name);
  const agentName = normalizeName(lead.agent_name);
  if (!agencyName) return null;

  const exactProjectAgencyAgent = agencyName && agentName ? indexes.byProjectAgencyAgent.get(`${project}|${agencyName}|${agentName}`) : null;
  if (exactProjectAgencyAgent?.size === 1) return [...exactProjectAgencyAgent][0];

  const exactProjectAgency = indexes.byProjectAgencyName.get(`${project}|${agencyName}`);
  if (exactProjectAgency?.size === 1) return [...exactProjectAgency][0];

  const exactGlobalAgencyAgent = agencyName && agentName ? indexes.byAgencyAgent.get(`${agencyName}|${agentName}`) : null;
  if (exactGlobalAgencyAgent?.size === 1) return [...exactGlobalAgencyAgent][0];

  const exactGlobalAgency = indexes.byAgencyName.get(agencyName);
  if (exactGlobalAgency?.size === 1) return [...exactGlobalAgency][0];

  return null;
};

const earliestDate = (left, right) => {
  const leftText = txt(left);
  const rightText = txt(right);
  if (!leftText) return rightText;
  if (!rightText) return leftText;
  return leftText.localeCompare(rightText) <= 0 ? leftText : rightText;
};

const buildRelationshipStage = (group) => {
  if (group.active_total > 0 || group.customer_total > 0) return "active";
  return "discarded";
};

const main = async () => {
  ensureDir(REFERENCE_DIR);
  ensureDir(REPORTS_DIR);

  if (!fs.existsSync(DB_MAP_JSON)) {
    throw new Error(`agency_db_map_missing:${relativeFromRoot(DB_MAP_JSON)}`);
  }

  const job = readJson(JOB_FILE);
  const dbMapRows = readJson(DB_MAP_JSON);
  const indexes = buildIndexes(dbMapRows);
  const leadSources = loadLeadSources(job);

  const groups = new Map();

  for (const source of leadSources) {
    const table = readCsvTable(source.absolutePath, Number(source.header_row ?? 0) || null);
    const leadRows = table.rows.map((row) => buildLeadRecord(source, row));

    leadRows.forEach((lead) => {
      const agencyName = txt(lead.agency_name);
      if (!agencyName || isGenericAgencyName(agencyName)) return;
      if (findExistingAgencyId(lead, indexes)) return;

      const key = reviewKeyFromLead(lead);
      const current = groups.get(key) ?? {
        review_key: key,
        dedupe_key: `lead_only:${key}`,
        project_label: lead.project_label ?? "",
        project_legacy_code: lead.project_legacy_code ?? "",
        source_file: lead.source_file ?? "",
        source_row_number: String(lead.source_row_number ?? ""),
        intake_date: txt(lead.intake_date),
        agency_name: agencyName,
        agent_name: txt(lead.agent_name),
        email: null,
        phone: null,
        country: txt(lead.nationality),
        managed_by: null,
        commercial_comment: null,
        agency_kit_sent: null,
        contract_sent: null,
        legal_name: null,
        tax_id: null,
        representative_name: null,
        representative_nie: null,
        role_label: "lead_derived_missing_master",
        skip_brand_match: true,
        docs_complete: null,
        signed_by_agency: null,
        signed_by_xavier: null,
        signed_date: null,
        collaboration_pct: null,
        resent_to_agency: null,
        legal_comment: null,
        uploaded_drive: null,
        uploaded_mobilia: null,
        combined_comments: null,
        raw_json: null,
        completeness_score: 0,
        lead_rows_total: 0,
        with_identity_total: 0,
        with_strong_identity_total: 0,
        customer_total: 0,
        discarded_total: 0,
        active_total: 0,
        sample_lead_names: [],
        sample_statuses: [],
        source_rows: [],
      };

      current.lead_rows_total += 1;
      if (txt(lead.lead_name) || txt(lead.email) || txt(lead.phone)) current.with_identity_total += 1;
      if (txt(lead.email) || txt(lead.phone)) current.with_strong_identity_total += 1;

      const statusClass = classifyStatus(lead.status);
      if (statusClass === "customer") current.customer_total += 1;
      else if (statusClass === "discarded") current.discarded_total += 1;
      else current.active_total += 1;

      current.intake_date = earliestDate(current.intake_date, lead.intake_date);
      if (txt(lead.source_file) && !current.source_file.includes(txt(lead.source_file))) {
        current.source_file = current.source_file ? `${current.source_file} | ${txt(lead.source_file)}` : txt(lead.source_file);
      }
      if (txt(lead.source_row_number)) current.source_rows.push(String(lead.source_row_number));
      if (txt(lead.lead_name) && !current.sample_lead_names.includes(txt(lead.lead_name)) && current.sample_lead_names.length < 8) {
        current.sample_lead_names.push(txt(lead.lead_name));
      }
      if (txt(lead.status) && !current.sample_statuses.includes(txt(lead.status)) && current.sample_statuses.length < 6) {
        current.sample_statuses.push(txt(lead.status));
      }

      current.relationship_stage = buildRelationshipStage(current);
      current.combined_comments =
        `Lead-derived missing master agency | registros=${current.lead_rows_total} | identidad=${current.with_identity_total}` +
        ` | customer=${current.customer_total} | discarded=${current.discarded_total} | active=${current.active_total}` +
        (current.sample_lead_names.length ? ` | muestras=${current.sample_lead_names.join(" ; ")}` : "");
      current.commercial_comment = current.combined_comments;
      current.raw_json = JSON.stringify({
        review_key: current.review_key,
        sample_lead_names: current.sample_lead_names,
        sample_statuses: current.sample_statuses,
        source_rows: current.source_rows.slice(0, 30),
      });
      current.completeness_score = 2 + (current.agent_name ? 1 : 0);
      groups.set(key, current);
    });
  }

  const stagingRows = [...groups.values()]
    .sort(
      (a, b) =>
        b.lead_rows_total - a.lead_rows_total ||
        a.project_label.localeCompare(b.project_label, "es") ||
        a.agency_name.localeCompare(b.agency_name, "es")
    )
    .map((row) => ({
      ...row,
      source_row_number: row.source_rows.join(" | "),
      dedupe_group_size: row.lead_rows_total,
    }));

  const csvRows = stagingRows.map((row) => ({
    review_key: row.review_key,
    project_label: row.project_label,
    project_legacy_code: row.project_legacy_code,
    agency_name: row.agency_name,
    agent_name: row.agent_name ?? "",
    lead_rows_total: row.lead_rows_total,
    with_identity_total: row.with_identity_total,
    with_strong_identity_total: row.with_strong_identity_total,
    customer_total: row.customer_total,
    discarded_total: row.discarded_total,
    active_total: row.active_total,
    intake_date: row.intake_date ?? "",
    source_file: row.source_file,
    source_row_number: row.source_row_number,
    combined_comments: row.combined_comments,
  }));

  const runTs = timestamp();
  const stagingJson = path.join(REFERENCE_DIR, "agency-lead-missing-master-staging-latest.json");
  const stagingCsv = path.join(REFERENCE_DIR, "agency-lead-missing-master-staging-latest.csv");
  const reportJson = path.join(REPORTS_DIR, `agency-lead-missing-master-${runTs}.json`);

  writeJson(stagingJson, stagingRows);
  writeCsv(stagingCsv, csvRows, [
    "review_key",
    "project_label",
    "project_legacy_code",
    "agency_name",
    "agent_name",
    "lead_rows_total",
    "with_identity_total",
    "with_strong_identity_total",
    "customer_total",
    "discarded_total",
    "active_total",
    "intake_date",
    "source_file",
    "source_row_number",
    "combined_comments",
  ]);
  writeJson(reportJson, {
    generated_at: new Date().toISOString(),
    job_file: relativeFromRoot(JOB_FILE),
    db_map_json: relativeFromRoot(DB_MAP_JSON),
    totals: {
      missing_groups_total: stagingRows.length,
      missing_lead_rows_total: stagingRows.reduce((sum, row) => sum + row.lead_rows_total, 0),
      customer_total: stagingRows.reduce((sum, row) => sum + row.customer_total, 0),
      discarded_total: stagingRows.reduce((sum, row) => sum + row.discarded_total, 0),
      active_total: stagingRows.reduce((sum, row) => sum + row.active_total, 0),
    },
    outputs: {
      staging_json: relativeFromRoot(stagingJson),
      staging_csv: relativeFromRoot(stagingCsv),
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        totals: {
          missing_groups_total: stagingRows.length,
          missing_lead_rows_total: stagingRows.reduce((sum, row) => sum + row.lead_rows_total, 0),
        },
        outputs: {
          staging_json: relativeFromRoot(stagingJson),
          staging_csv: relativeFromRoot(stagingCsv),
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
