import path from "node:path";
import {
  ROOT,
  arg,
  ensureDir,
  buildAgencyRecord,
  readCsvTable,
  readJson,
  relativeFromRoot,
  timestamp,
  writeCsv,
  writeJson,
  mergeUniqueText,
  txt,
} from "./agency-import/shared.mjs";

const DEFAULT_JOB_FILE = path.join(ROOT, "scripts", "agency-import", "jobs", "default-agencies.json");
const REFERENCE_DIR = path.join(ROOT, "scripts", "agency-import", "reference");
const REPORTS_DIR = path.join(ROOT, "scripts", "agency-import", "reports");

const JOB_FILE = path.isAbsolute(arg("job-file") ?? "") ? arg("job-file") : path.join(ROOT, arg("job-file") ?? DEFAULT_JOB_FILE);

const loadSources = (job) => {
  if (!Array.isArray(job.sources) || !job.sources.length) {
    throw new Error("agency_job_sources_required");
  }
  return job.sources.map((source) => {
    const file = txt(source.file);
    if (!file) throw new Error("agency_source_file_required");
    const absolutePath = path.isAbsolute(file) ? file : path.join(ROOT, file);
    return {
      ...source,
      absolutePath,
    };
  });
};

const collapseGroup = (items) => {
  const sorted = [...items].sort((a, b) => {
    if ((b.completeness_score ?? 0) !== (a.completeness_score ?? 0)) {
      return (b.completeness_score ?? 0) - (a.completeness_score ?? 0);
    }
    return String(a.source_file).localeCompare(String(b.source_file)) || Number(a.source_row_number) - Number(b.source_row_number);
  });

  const primary = sorted[0];
  const boolAny = (key) => (sorted.some((item) => item[key] === true) ? true : sorted.some((item) => item[key] === false) ? false : null);
  const pickFirst = (key) => sorted.find((item) => txt(item[key]))?.[key] ?? null;

  return {
    ...primary,
    source_file: sorted.map((item) => item.source_file).filter(Boolean).join(" | "),
    source_row_number: sorted.map((item) => item.source_row_number).filter(Boolean).join(" | "),
    project_label: mergeUniqueText(sorted.map((item) => item.project_label)),
    project_legacy_code: mergeUniqueText(sorted.map((item) => item.project_legacy_code)),
    intake_date: pickFirst("intake_date"),
    source_channel: mergeUniqueText(sorted.map((item) => item.source_channel)),
    relationship_stage_raw: mergeUniqueText(sorted.map((item) => item.relationship_stage_raw)),
    relationship_stage: pickFirst("relationship_stage") ?? "unknown",
    agency_name: pickFirst("agency_name"),
    agent_name: pickFirst("agent_name"),
    email: pickFirst("email"),
    phone: pickFirst("phone"),
    country: mergeUniqueText(sorted.map((item) => item.country)),
    managed_by: mergeUniqueText(sorted.map((item) => item.managed_by)),
    commercial_comment: mergeUniqueText(sorted.map((item) => item.commercial_comment)),
    agency_kit_sent: boolAny("agency_kit_sent"),
    contract_sent: boolAny("contract_sent"),
    legal_name: pickFirst("legal_name"),
    tax_id: pickFirst("tax_id"),
    representative_name: pickFirst("representative_name"),
    representative_nie: pickFirst("representative_nie"),
    role_label: mergeUniqueText(sorted.map((item) => item.role_label)),
    docs_complete: boolAny("docs_complete"),
    signed_by_agency: boolAny("signed_by_agency"),
    signed_by_xavier: boolAny("signed_by_xavier"),
    signed_date: pickFirst("signed_date"),
    collaboration_pct: sorted.find((item) => typeof item.collaboration_pct === "number")?.collaboration_pct ?? null,
    resent_to_agency: mergeUniqueText(sorted.map((item) => item.resent_to_agency)),
    legal_comment: mergeUniqueText(sorted.map((item) => item.legal_comment)),
    uploaded_drive: boolAny("uploaded_drive"),
    uploaded_mobilia: boolAny("uploaded_mobilia"),
    combined_comments: mergeUniqueText(sorted.map((item) => item.combined_comments)),
    raw_json: JSON.stringify(sorted.map((item) => JSON.parse(item.raw_json))),
    dedupe_group_size: sorted.length,
  };
};

const csvHeaders = [
  "project_label",
  "project_legacy_code",
  "source_file",
  "source_row_number",
  "intake_date",
  "source_channel",
  "relationship_stage_raw",
  "relationship_stage",
  "agency_name",
  "agent_name",
  "email",
  "phone",
  "country",
  "managed_by",
  "commercial_comment",
  "agency_kit_sent",
  "contract_sent",
  "legal_name",
  "tax_id",
  "representative_name",
  "representative_nie",
  "role_label",
  "docs_complete",
  "signed_by_agency",
  "signed_by_xavier",
  "signed_date",
  "collaboration_pct",
  "resent_to_agency",
  "legal_comment",
  "uploaded_drive",
  "uploaded_mobilia",
  "combined_comments",
  "dedupe_key_type",
  "dedupe_key",
  "completeness_score",
  "dedupe_group_size",
];

const main = async () => {
  ensureDir(REFERENCE_DIR);
  ensureDir(REPORTS_DIR);

  const job = readJson(JOB_FILE);
  const sources = loadSources(job);
  const stagingRows = [];
  const sourceStats = [];

  for (const source of sources) {
    const table = readCsvTable(source.absolutePath, Number(source.header_row ?? 0) || null);
    const rows = table.rows.map((row) => buildAgencyRecord(source, row));
    stagingRows.push(...rows);
    sourceStats.push({
      file: relativeFromRoot(table.absolutePath),
      project_label: source.project_label ?? null,
      project_legacy_code: source.project_legacy_code ?? null,
      encoding: table.encoding,
      delimiter: table.delimiter,
      header_row: table.header_index,
      rows: rows.length,
      rows_with_contact_identity: rows.filter((row) => row.email || row.phone).length,
      rows_with_tax_id: rows.filter((row) => row.tax_id).length,
    });
  }

  const groups = new Map();
  stagingRows.forEach((row) => {
    const bucket = groups.get(row.dedupe_key) ?? [];
    bucket.push(row);
    groups.set(row.dedupe_key, bucket);
  });

  const dedupedRows = Array.from(groups.values()).map(collapseGroup);
  dedupedRows.sort((a, b) => {
    return String(a.project_label ?? "").localeCompare(String(b.project_label ?? ""), "es") ||
      String(a.agency_name ?? "").localeCompare(String(b.agency_name ?? ""), "es");
  });

  const runTs = timestamp();
  const stagingCsv = path.join(REFERENCE_DIR, "agency-staging-latest.csv");
  const dedupedCsv = path.join(REFERENCE_DIR, "agency-staging-deduped-latest.csv");
  const dedupedJson = path.join(REFERENCE_DIR, "agency-staging-deduped-latest.json");
  const reportJson = path.join(REPORTS_DIR, `agency-staging-${runTs}.json`);

  writeCsv(stagingCsv, stagingRows, csvHeaders);
  writeCsv(dedupedCsv, dedupedRows, csvHeaders);
  writeJson(dedupedJson, dedupedRows);
  writeJson(reportJson, {
    generated_at: new Date().toISOString(),
    job_file: relativeFromRoot(JOB_FILE),
    totals: {
      staging_rows: stagingRows.length,
      deduped_rows: dedupedRows.length,
      duplicates_collapsed: stagingRows.length - dedupedRows.length,
    },
    source_stats: sourceStats,
    dedupe_key_types: Array.from(groups.values()).reduce((acc, items) => {
      const key = items[0]?.dedupe_key_type ?? "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    outputs: {
      staging_csv: relativeFromRoot(stagingCsv),
      deduped_csv: relativeFromRoot(dedupedCsv),
      deduped_json: relativeFromRoot(dedupedJson),
    },
  });

  console.log(JSON.stringify({
    ok: true,
    job_file: relativeFromRoot(JOB_FILE),
    staging_rows: stagingRows.length,
    deduped_rows: dedupedRows.length,
    outputs: {
      staging_csv: relativeFromRoot(stagingCsv),
      deduped_csv: relativeFromRoot(dedupedCsv),
      deduped_json: relativeFromRoot(dedupedJson),
      report_json: relativeFromRoot(reportJson),
    },
  }, null, 2));
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
