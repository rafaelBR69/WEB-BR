import fs from "node:fs";
import path from "node:path";
import {
  ROOT,
  arg,
  ensureDir,
  buildLeadRecord,
  canonical,
  readCsvTable,
  readJson,
  relativeFromRoot,
  timestamp,
  txt,
  writeCsv,
  writeJson,
} from "./agency-import/shared.mjs";

const DEFAULT_JOB_FILE = path.join(ROOT, "scripts", "agency-import", "jobs", "default-agencies.json");
const REFERENCE_DIR = path.join(ROOT, "scripts", "agency-import", "reference");
const REPORTS_DIR = path.join(ROOT, "scripts", "agency-import", "reports");
const JOB_FILE = path.isAbsolute(arg("job-file") ?? "") ? arg("job-file") : path.join(ROOT, arg("job-file") ?? DEFAULT_JOB_FILE);
const DEDUPED_JSON = path.join(REFERENCE_DIR, "agency-staging-deduped-latest.json");

const normalizeName = (value) => canonical(value).replace(/\s+/g, " ").trim() || null;

const loadLeadSources = (job) => {
  if (!Array.isArray(job.lead_sources) || !job.lead_sources.length) {
    throw new Error("agency_job_lead_sources_required");
  }
  return job.lead_sources.map((source) => {
    const file = txt(source.file);
    if (!file) throw new Error("lead_source_file_required");
    const absolutePath = path.isAbsolute(file) ? file : path.join(ROOT, file);
    return {
      ...source,
      absolutePath,
    };
  });
};

const isAgencyLeadRow = (lead) => {
  const type = normalizeName(lead.lead_type);
  const agencyName = normalizeName(lead.agency_name);
  return type?.includes("agencia") || (agencyName && agencyName !== "sin agencia");
};

const buildLeadAgencyKey = (lead) => {
  const project = txt(lead.project_label) ?? "no-project";
  const agencyName = normalizeName(lead.agency_name);
  const agentName = normalizeName(lead.agent_name);
  const email = txt(lead.email);
  const phone = txt(lead.phone);

  if (agencyName && email) return `agency_email|${project}|${agencyName}|${email}`;
  if (agencyName && phone) return `agency_phone|${project}|${agencyName}|${phone}`;
  if (agentName && email) return `agent_email|${project}|${agentName}|${email}`;
  if (agentName && phone) return `agent_phone|${project}|${agentName}|${phone}`;
  if (agencyName && agentName) return `agency_agent|${project}|${agencyName}|${agentName}`;
  if (agencyName) return `agency_only|${project}|${agencyName}`;
  if (email) return `email_only|${project}|${email}`;
  if (phone) return `phone_only|${project}|${phone}`;
  return null;
};

const scoreLeadAgencyCompleteness = (lead) =>
  ["agency_name", "agent_name", "email", "phone", "lead_name", "comments"].reduce(
    (sum, key) => sum + (txt(lead[key]) ? 1 : 0),
    0
  );

const collapseLeadAgencyGroup = (items) => {
  const sorted = [...items].sort((a, b) => {
    const scoreDiff = scoreLeadAgencyCompleteness(b) - scoreLeadAgencyCompleteness(a);
    if (scoreDiff !== 0) return scoreDiff;
    return String(a.source_file).localeCompare(String(b.source_file)) || Number(a.source_row_number) - Number(b.source_row_number);
  });
  const primary = sorted[0];
  return {
    ...primary,
    source_file: sorted.map((item) => item.source_file).filter(Boolean).join(" | "),
    source_row_number: sorted.map((item) => item.source_row_number).filter(Boolean).join(" | "),
    source_count: sorted.length,
  };
};

const matchLeadAgencyToMaster = (leadAgency, agency) => {
  const reasons = [];
  let score = 0;

  if (agency.project_label && leadAgency.project_label && agency.project_label !== leadAgency.project_label) {
    return { score: -1, status: "no_match", reasons: ["different_project"] };
  }

  const leadEmail = txt(leadAgency.email);
  const agencyEmail = txt(agency.email);
  const leadPhone = txt(leadAgency.phone);
  const agencyPhone = txt(agency.phone);
  const leadAgencyName = normalizeName(leadAgency.agency_name);
  const agencyName = normalizeName(agency.agency_name);
  const leadAgent = normalizeName(leadAgency.agent_name);
  const agencyAgent = normalizeName(agency.agent_name);

  if (leadEmail && agencyEmail && leadEmail === agencyEmail) {
    score += 100;
    reasons.push("email_exact");
  }
  if (leadPhone && agencyPhone && leadPhone === agencyPhone) {
    score += 100;
    reasons.push("phone_exact");
  }
  if (leadAgencyName && agencyName && leadAgencyName === agencyName) {
    score += 55;
    reasons.push("agency_name_exact");
  }
  if (leadAgent && agencyAgent && leadAgent === agencyAgent) {
    score += 35;
    reasons.push("agent_name_exact");
  }
  if (leadAgencyName && agencyName && leadAgent && agencyAgent && leadAgencyName === agencyName && leadAgent === agencyAgent) {
    score += 20;
    reasons.push("agency_plus_agent");
  }

  let status = "no_match";
  if (reasons.includes("email_exact") || reasons.includes("phone_exact")) {
    status = "exact";
  } else if (score >= 85) {
    status = "candidate";
  } else if (score >= 50) {
    status = "manual_review";
  }

  return { score, status, reasons };
};

const csvHeaders = [
  "project_label",
  "project_legacy_code",
  "lead_unique_key",
  "agency_dedupe_key",
  "match_status",
  "match_score",
  "match_reasons",
  "lead_agency_name",
  "lead_agent_name",
  "lead_email",
  "lead_phone",
  "lead_name",
  "lead_status",
  "lead_channel",
  "lead_source_file",
  "lead_source_row_number",
  "lead_source_count",
  "agency_name",
  "agency_agent_name",
  "agency_email",
  "agency_phone",
  "agency_tax_id",
  "agency_source_file",
  "agency_source_row_number",
  "lead_comments",
];

const main = async () => {
  ensureDir(REFERENCE_DIR);
  ensureDir(REPORTS_DIR);

  const job = readJson(JOB_FILE);
  if (!fs.existsSync(DEDUPED_JSON)) {
    throw new Error(`agency_deduped_json_missing:${relativeFromRoot(DEDUPED_JSON)}`);
  }

  const agencies = readJson(DEDUPED_JSON);
  const leadSources = loadLeadSources(job);
  const leadRows = [];

  for (const source of leadSources) {
    const table = readCsvTable(source.absolutePath, Number(source.header_row ?? 0) || null);
    leadRows.push(...table.rows.map((row) => buildLeadRecord(source, row)).filter(isAgencyLeadRow));
  }

  const groupedLeadAgencies = new Map();
  leadRows.forEach((lead) => {
    const key = buildLeadAgencyKey(lead);
    if (!key) return;
    const bucket = groupedLeadAgencies.get(key) ?? [];
    bucket.push(lead);
    groupedLeadAgencies.set(key, bucket);
  });

  const uniqueLeadAgencies = Array.from(groupedLeadAgencies.values()).map(collapseLeadAgencyGroup);
  const reviewRows = [];
  let exactMatches = 0;
  let candidateMatches = 0;
  let manualReviewMatches = 0;
  let unmatchedLeadAgencies = 0;

  for (const leadAgency of uniqueLeadAgencies) {
    const candidates = agencies
      .filter((agency) => agency.project_label === leadAgency.project_label)
      .map((agency) => ({ agency, ...matchLeadAgencyToMaster(leadAgency, agency) }))
      .filter((entry) => entry.score >= 0 && entry.status !== "no_match")
      .sort((a, b) => b.score - a.score || String(a.agency.agency_name ?? "").localeCompare(String(b.agency.agency_name ?? ""), "es"));

    if (!candidates.length) {
      unmatchedLeadAgencies += 1;
      continue;
    }

    const best = candidates[0];
    reviewRows.push({
      project_label: leadAgency.project_label ?? "",
      project_legacy_code: leadAgency.project_legacy_code ?? "",
      lead_unique_key: buildLeadAgencyKey(leadAgency) ?? "",
      agency_dedupe_key: best.agency.dedupe_key ?? "",
      match_status: best.status,
      match_score: best.score,
      match_reasons: best.reasons.join(" | "),
      lead_agency_name: leadAgency.agency_name ?? "",
      lead_agent_name: leadAgency.agent_name ?? "",
      lead_email: leadAgency.email ?? "",
      lead_phone: leadAgency.phone ?? "",
      lead_name: leadAgency.lead_name ?? "",
      lead_status: leadAgency.status ?? "",
      lead_channel: leadAgency.channel ?? "",
      lead_source_file: leadAgency.source_file ?? "",
      lead_source_row_number: leadAgency.source_row_number ?? "",
      lead_source_count: leadAgency.source_count ?? 1,
      agency_name: best.agency.agency_name ?? "",
      agency_agent_name: best.agency.agent_name ?? "",
      agency_email: best.agency.email ?? "",
      agency_phone: best.agency.phone ?? "",
      agency_tax_id: best.agency.tax_id ?? "",
      agency_source_file: best.agency.source_file ?? "",
      agency_source_row_number: best.agency.source_row_number ?? "",
      lead_comments: leadAgency.comments ?? "",
    });

    if (best.status === "exact") exactMatches += 1;
    else if (best.status === "candidate") candidateMatches += 1;
    else if (best.status === "manual_review") manualReviewMatches += 1;
  }

  reviewRows.sort((a, b) => {
    return String(a.project_label).localeCompare(String(b.project_label), "es") ||
      String(a.match_status).localeCompare(String(b.match_status), "es") ||
      Number(b.match_score) - Number(a.match_score);
  });

  const runTs = timestamp();
  const reviewCsv = path.join(REFERENCE_DIR, "agency-lead-match-review-latest.csv");
  const reportJson = path.join(REPORTS_DIR, `agency-lead-match-${runTs}.json`);

  writeCsv(reviewCsv, reviewRows, csvHeaders);
  writeJson(reportJson, {
    generated_at: new Date().toISOString(),
    job_file: relativeFromRoot(JOB_FILE),
    totals: {
      lead_agency_rows_total: leadRows.length,
      lead_agencies_unique: uniqueLeadAgencies.length,
      agencies_master_deduped: agencies.length,
      matched_unique_lead_agencies: reviewRows.length,
      exact_matches: exactMatches,
      candidate_matches: candidateMatches,
      manual_review_matches: manualReviewMatches,
      unmatched_unique_lead_agencies: unmatchedLeadAgencies,
    },
    outputs: {
      review_csv: relativeFromRoot(reviewCsv),
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        lead_agency_rows_total: leadRows.length,
        lead_agencies_unique: uniqueLeadAgencies.length,
        agencies_master_deduped: agencies.length,
        matched_unique_lead_agencies: reviewRows.length,
        exact_matches: exactMatches,
        candidate_matches: candidateMatches,
        manual_review_matches: manualReviewMatches,
        unmatched_unique_lead_agencies: unmatchedLeadAgencies,
        outputs: {
          review_csv: relativeFromRoot(reviewCsv),
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
