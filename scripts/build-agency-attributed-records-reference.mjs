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
const DEFAULT_DECISIONS_CSV = path.join(
  ROOT,
  "scripts",
  "agency-import",
  "reference",
  "agency-attributed-review-decisions.csv"
);
const REFERENCE_DIR = path.join(ROOT, "scripts", "agency-import", "reference");
const REPORTS_DIR = path.join(ROOT, "scripts", "agency-import", "reports");

const resolveCliPath = (value, fallback) => {
  const selected = txt(value) ?? fallback;
  return path.isAbsolute(selected) ? selected : path.join(ROOT, selected);
};

const JOB_FILE = resolveCliPath(arg("job-file"), DEFAULT_JOB_FILE);
const DB_MAP_JSON = resolveCliPath(arg("db-map-json"), DEFAULT_DB_MAP_JSON);
const DECISIONS_CSV = resolveCliPath(arg("decisions-csv"), DEFAULT_DECISIONS_CSV);

const normalizeName = (value) => canonical(value).replace(/\s+/g, " ").trim() || null;
const tokenizeName = (value) =>
  (normalizeName(value) ?? "")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
const normalizeEmailLocalPart = (value) => {
  const text = txt(value)?.toLowerCase();
  if (!text || !text.includes("@")) return null;
  return canonical(text.split("@")[0]).replace(/\s+/g, " ").trim() || null;
};
const pushUnique = (array, value) => {
  const text = txt(value);
  if (!text || array.includes(text)) return;
  array.push(text);
};

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
  const [headers = [], ...body] = rows;
  return body.map((current) =>
    headers.reduce((acc, key, index) => {
      acc[key] = current[index] ?? "";
      return acc;
    }, {})
  );
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
  if (!normalized) return { status_class: "unknown", status_label: "Sin estado" };
  if (
    normalized.includes("cliente") ||
    normalized.includes("client") ||
    normalized.includes("customer") ||
    normalized.includes("convert") ||
    normalized.includes("compr") ||
    normalized.includes("reserv")
  ) {
    return { status_class: "customer", status_label: txt(value) ?? "Cliente" };
  }
  if (
    normalized.includes("baja") ||
    normalized.includes("descart") ||
    normalized.includes("lost") ||
    normalized.includes("perdid") ||
    normalized.includes("junk")
  ) {
    return { status_class: "discarded", status_label: txt(value) ?? "Descartado" };
  }
  return { status_class: "active", status_label: txt(value) ?? "Activo" };
};

const monthKey = (value) => {
  const text = txt(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

const monthLabel = (key) => {
  const [year, month] = String(key).split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("es-ES", { month: "short", year: "2-digit" });
};

const ensureSetMap = (map, key) => {
  if (!map.has(key)) map.set(key, new Set());
  return map.get(key);
};

const addIndexValue = (map, key, agencyId) => {
  if (!key || !agencyId) return;
  ensureSetMap(map, key).add(agencyId);
};

const reviewKeyFromLead = (lead) =>
  [txt(lead.project_label) ?? "", normalizeName(lead.agency_name) ?? "", normalizeName(lead.agent_name) ?? ""].join("|");

const loadDecisions = () => {
  const decisions = new Map();
  if (!fs.existsSync(DECISIONS_CSV)) return decisions;
  parseCsv(DECISIONS_CSV).forEach((row) => {
    const reviewKey = txt(row.review_key);
    if (!reviewKey) return;
    decisions.set(reviewKey, {
      decision: normalizeName(row.decision) ?? "",
      selected_agency_id: txt(row.selected_agency_id),
      notes: txt(row.notes),
    });
  });
  return decisions;
};

const buildIndexes = (rows) => {
  const indexes = {
    byProjectAgencyName: new Map(),
    byProjectAgentName: new Map(),
    byProjectAgencyAgent: new Map(),
    byAgencyName: new Map(),
    byAgencyAgent: new Map(),
    byAgentName: new Map(),
    agencyInfoById: new Map(),
    contactCandidatesByAgencyId: new Map(),
  };

  rows.forEach((row) => {
    const agencyId = txt(row.agency_id);
    if (!agencyId) return;
    const project = txt(row.project_label) ?? "";
    const agencyName = normalizeName(row.agency_name);
    const agentName = normalizeName(row.agent_name);
    const agencyContactId = txt(row.agency_contact_id);
    const role = txt(row.role) ?? "base";
    const emailLocal = normalizeEmailLocalPart(row.email);

    if (!indexes.agencyInfoById.has(agencyId)) {
      indexes.agencyInfoById.set(agencyId, {
        agency_id: agencyId,
        agency_name: txt(row.agency_name) ?? txt(row.agent_name) ?? txt(row.agency_code) ?? "Agencia",
        agency_names: [],
        agent_names: [],
        project_labels: [],
        project_legacy_codes: [],
        emails: [],
        phones: [],
      });
    }

    const info = indexes.agencyInfoById.get(agencyId);
    pushUnique(info.agency_names, txt(row.agency_name));
    pushUnique(info.agent_names, txt(row.agent_name));
    pushUnique(info.project_labels, txt(row.project_label));
    pushUnique(info.project_legacy_codes, txt(row.project_legacy_code));
    pushUnique(info.emails, txt(row.email));
    pushUnique(info.phones, txt(row.phone));

    addIndexValue(indexes.byProjectAgencyName, `${project}|${agencyName ?? ""}`, agencyId);
    addIndexValue(indexes.byProjectAgentName, `${project}|${agentName ?? ""}`, agencyId);
    addIndexValue(indexes.byProjectAgencyAgent, `${project}|${agencyName ?? ""}|${agentName ?? ""}`, agencyId);
    addIndexValue(indexes.byAgencyName, agencyName ?? "", agencyId);
    addIndexValue(indexes.byAgencyAgent, `${agencyName ?? ""}|${agentName ?? ""}`, agencyId);
    addIndexValue(indexes.byAgentName, agentName ?? "", agencyId);

    if (agencyContactId && role === "agent") {
      const currentCandidates = indexes.contactCandidatesByAgencyId.get(agencyId) ?? [];
      currentCandidates.push({
        agency_contact_id: agencyContactId,
        agency_id: agencyId,
        full_name: txt(row.agent_name),
        normalized_name: agentName,
        email_local: emailLocal,
      });
      indexes.contactCandidatesByAgencyId.set(agencyId, currentCandidates);
    }
  });

  return indexes;
};

const resolveAgencyContactMatch = (lead, agencyId, indexes) => {
  const agentName = normalizeName(lead.agent_name);
  if (!agencyId || !agentName) {
    return { agency_contact_id: null, match_score: 0, match_reasons: [] };
  }

  const leadTokens = tokenizeName(agentName);
  const candidates = indexes.contactCandidatesByAgencyId.get(agencyId) ?? [];
  let bestScore = 0;
  const ranked = [];

  candidates.forEach((candidate) => {
    let score = 0;
    const reasons = [];

    if (candidate.normalized_name && candidate.normalized_name === agentName) {
      score = Math.max(score, 120);
      reasons.push("contact_name_exact");
    }
    if (candidate.email_local) {
      const emailTokens = tokenizeName(candidate.email_local);
      leadTokens.forEach((token) => {
        if (candidate.email_local === token || candidate.email_local.startsWith(token)) {
          score = Math.max(score, 85);
          reasons.push("contact_email_local_prefix");
        } else if (emailTokens.includes(token)) {
          score = Math.max(score, 70);
          reasons.push("contact_email_local_token");
        }
      });
    }

    if (score <= 0) return;
    bestScore = Math.max(bestScore, score);
    ranked.push({
      agency_contact_id: candidate.agency_contact_id,
      normalized_name: candidate.normalized_name ?? "",
      email_local: candidate.email_local ?? "",
      match_score: score,
      match_reasons: [...new Set(reasons)].sort(),
    });
  });

  if (!ranked.length || bestScore <= 0) {
    return { agency_contact_id: null, match_score: 0, match_reasons: [] };
  }

  const bestMatches = ranked
    .filter((candidate) => candidate.match_score === bestScore)
    .sort((a, b) => a.agency_contact_id.localeCompare(b.agency_contact_id));

  if (bestMatches.length === 1) {
    const [best] = bestMatches;
    return {
      agency_contact_id: best.agency_contact_id,
      match_score: best.match_score,
      match_reasons: best.match_reasons,
    };
  }

  const identityKeys = new Set(
    bestMatches.map((candidate) => `${candidate.normalized_name}|${candidate.email_local}`)
  );
  if (identityKeys.size === 1) {
    const [best] = bestMatches;
    return {
      agency_contact_id: best.agency_contact_id,
      match_score: best.match_score,
      match_reasons: best.match_reasons,
    };
  }

  return { agency_contact_id: null, match_score: 0, match_reasons: [] };
};

const addCandidateScore = (bucket, agencyIds, score, reason) => {
  if (!(agencyIds instanceof Set) || !agencyIds.size || score <= 0) return;
  agencyIds.forEach((agencyId) => {
    const current = bucket.get(agencyId) ?? { score: 0, reasons: [] };
    current.score += score;
    if (!current.reasons.includes(reason)) current.reasons.push(reason);
    bucket.set(agencyId, current);
  });
};

const isLooseNameMatch = (left, right) => {
  if (!left || !right) return false;
  if (left === right) return true;
  return left.includes(right) || right.includes(left);
};

const addFuzzyAgencyScores = (bucket, lead, indexes) => {
  const project = txt(lead.project_label) ?? "";
  const agencyName = normalizeName(lead.agency_name);
  const agentName = normalizeName(lead.agent_name);
  if (!agencyName && !agentName) return;

  indexes.agencyInfoById.forEach((info, agencyId) => {
    const normalizedAgencyNames = (info.agency_names ?? []).map((value) => normalizeName(value)).filter(Boolean);
    const normalizedAgentNames = (info.agent_names ?? []).map((value) => normalizeName(value)).filter(Boolean);
    const leadAgentTokens = tokenizeName(agentName);
    const contactAgentMatch = (indexes.contactCandidatesByAgencyId.get(agencyId) ?? []).some((candidate) => {
      if (candidate.normalized_name && agentName && isLooseNameMatch(candidate.normalized_name, agentName)) return true;
      if (!candidate.email_local || !leadAgentTokens.length) return false;
      return leadAgentTokens.some(
        (token) => candidate.email_local === token || candidate.email_local.startsWith(token) || token.startsWith(candidate.email_local)
      );
    });
    const projectMatch = (info.project_labels ?? []).some((value) => (txt(value) ?? "") === project);
    const agencyMatch = agencyName
      ? normalizedAgencyNames.some((value) => isLooseNameMatch(value, agencyName))
      : false;
    const agentMatch = agentName
      ? normalizedAgentNames.some((value) => isLooseNameMatch(value, agentName))
      : false;

    if (agencyMatch && contactAgentMatch && projectMatch) {
      addCandidateScore(bucket, new Set([agencyId]), 145, "project_agency_contact_fuzzy");
      return;
    }
    if (agencyMatch && contactAgentMatch) {
      addCandidateScore(bucket, new Set([agencyId]), 115, "agency_contact_fuzzy");
      return;
    }
    if (agencyMatch && agentMatch && projectMatch) {
      addCandidateScore(bucket, new Set([agencyId]), 125, "project_agency_agent_fuzzy");
      return;
    }
    if (agencyMatch && projectMatch) {
      addCandidateScore(bucket, new Set([agencyId]), 105, "project_agency_fuzzy");
      return;
    }
    if (agencyMatch && agentMatch) {
      addCandidateScore(bucket, new Set([agencyId]), 95, "agency_agent_fuzzy");
      return;
    }
    if (agencyMatch) {
      addCandidateScore(bucket, new Set([agencyId]), 70, "agency_fuzzy");
      return;
    }
    if (!agencyName && agentMatch && projectMatch) {
      addCandidateScore(bucket, new Set([agencyId]), 60, "project_agent_fuzzy");
    }
  });
};

const resolveAgencyMatch = (lead, indexes) => {
  const project = txt(lead.project_label) ?? "";
  const agencyName = normalizeName(lead.agency_name);
  const agentName = normalizeName(lead.agent_name);
  const candidates = new Map();

  if (agencyName && agentName) {
    addCandidateScore(
      candidates,
      indexes.byProjectAgencyAgent.get(`${project}|${agencyName}|${agentName}`),
      160,
      "project_agency_agent"
    );
    addCandidateScore(candidates, indexes.byAgencyAgent.get(`${agencyName}|${agentName}`), 120, "global_agency_agent");
  }
  if (agencyName) {
    addCandidateScore(candidates, indexes.byProjectAgencyName.get(`${project}|${agencyName}`), 130, "project_agency");
    addCandidateScore(candidates, indexes.byAgencyName.get(agencyName), 90, "global_agency");
  }
  if (!agencyName && agentName) {
    addCandidateScore(candidates, indexes.byProjectAgentName.get(`${project}|${agentName}`), 80, "project_agent_only");
    addCandidateScore(candidates, indexes.byAgentName.get(agentName), 50, "global_agent_only");
  }
  addFuzzyAgencyScores(candidates, lead, indexes);

  const ranked = [...candidates.entries()]
    .map(([agencyId, value]) => ({ agencyId, score: value.score, reasons: value.reasons.sort() }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.agencyId.localeCompare(b.agencyId));

  if (!ranked.length) {
    return { match_status: "unmatched", match_score: 0, match_reasons: [], agency_id: null, candidates: [] };
  }

  const [best, second] = ranked;
  if (second && second.score === best.score) {
    return {
      match_status: "ambiguous",
      match_score: best.score,
      match_reasons: best.reasons,
      agency_id: null,
      candidates: ranked,
    };
  }

  const matchStatus = best.score >= 130 ? "exact" : best.score >= 90 ? "candidate" : best.score >= 50 ? "manual" : "weak";
  if (matchStatus === "manual" || matchStatus === "weak") {
    return {
      match_status: matchStatus,
      match_score: best.score,
      match_reasons: best.reasons,
      agency_id: null,
      candidates: ranked,
    };
  }

  return {
    match_status: matchStatus,
    match_score: best.score,
    match_reasons: best.reasons,
    agency_id: best.agencyId,
    candidates: ranked,
  };
};

const createSummaryState = () => ({
  attributed_records_total: 0,
  records_with_identity_total: 0,
  records_without_identity_total: 0,
  records_with_strong_identity_total: 0,
  customer_total: 0,
  discarded_total: 0,
  active_total: 0,
  monthly: new Map(),
  statuses: new Map(),
  projects: new Map(),
  source_files: new Map(),
  sample_lead_names: [],
});

const bumpStatusTotals = (state, statusClass) => {
  if (statusClass === "customer") state.customer_total += 1;
  else if (statusClass === "discarded") state.discarded_total += 1;
  else state.active_total += 1;
};

const addMonthlyTotals = (state, key, flags) => {
  if (!key) return;
  const current = state.monthly.get(key) ?? {
    month_key: key,
    total: 0,
    with_identity_total: 0,
    without_identity_total: 0,
    customer_total: 0,
    discarded_total: 0,
    active_total: 0,
  };
  current.total += 1;
  if (flags.hasIdentity) current.with_identity_total += 1;
  else current.without_identity_total += 1;
  if (flags.statusClass === "customer") current.customer_total += 1;
  else if (flags.statusClass === "discarded") current.discarded_total += 1;
  else current.active_total += 1;
  state.monthly.set(key, current);
};

const addProjectTotals = (state, projectLabel, projectLegacyCode, flags) => {
  const key = `${projectLabel ?? ""}|${projectLegacyCode ?? ""}`;
  const current = state.projects.get(key) ?? {
    project_label: projectLabel ?? "",
    project_legacy_code: projectLegacyCode ?? "",
    total: 0,
    with_identity_total: 0,
    customer_total: 0,
    discarded_total: 0,
    active_total: 0,
  };
  current.total += 1;
  if (flags.hasIdentity) current.with_identity_total += 1;
  if (flags.statusClass === "customer") current.customer_total += 1;
  else if (flags.statusClass === "discarded") current.discarded_total += 1;
  else current.active_total += 1;
  state.projects.set(key, current);
};

const addSourceFileTotal = (state, sourceFile) => {
  const key = txt(sourceFile);
  if (!key) return;
  state.source_files.set(key, (state.source_files.get(key) ?? 0) + 1);
};

const addSampleLeadName = (state, leadName) => {
  const text = txt(leadName);
  if (!text || state.sample_lead_names.includes(text) || state.sample_lead_names.length >= 8) return;
  state.sample_lead_names.push(text);
};

const finalizeSummaryState = (state) => ({
  attributed_records_total: state.attributed_records_total,
  records_with_identity_total: state.records_with_identity_total,
  records_without_identity_total: state.records_without_identity_total,
  records_with_strong_identity_total: state.records_with_strong_identity_total,
  customer_total: state.customer_total,
  discarded_total: state.discarded_total,
  active_total: state.active_total,
  monthly_records: [...state.monthly.values()]
    .sort((a, b) => a.month_key.localeCompare(b.month_key))
    .map((row) => ({ ...row, month_label: monthLabel(row.month_key) })),
  status_breakdown: [...state.statuses.entries()]
    .map(([status_label, total]) => ({ status_label, total }))
    .sort((a, b) => b.total - a.total || a.status_label.localeCompare(b.status_label, "es")),
  project_mix: [...state.projects.values()]
    .sort((a, b) => b.total - a.total || a.project_label.localeCompare(b.project_label, "es"))
    .slice(0, 12),
  source_files: [...state.source_files.entries()]
    .map(([source_file, total]) => ({ source_file, total }))
    .sort((a, b) => b.total - a.total || a.source_file.localeCompare(b.source_file, "es")),
  sample_lead_names: state.sample_lead_names,
});

const agenciesCsvHeaders = [
  "agency_id",
  "agency_name",
  "project_labels",
  "attributed_records_total",
  "records_with_identity_total",
  "records_without_identity_total",
  "records_with_strong_identity_total",
  "customer_total",
  "discarded_total",
  "active_total",
  "crm_linked_leads_total",
];

const reviewCsvHeaders = [
  "review_key",
  "match_status",
  "project_label",
  "project_legacy_code",
  "lead_agency_name",
  "lead_agent_name",
  "records_total",
  "records_with_identity_total",
  "records_with_strong_identity_total",
  "customer_total",
  "discarded_total",
  "active_total",
  "sample_lead_names",
  "candidate_1_agency_id",
  "candidate_1_agency_name",
  "candidate_1_score",
  "candidate_1_reasons",
  "candidate_2_agency_id",
  "candidate_2_agency_name",
  "candidate_2_score",
  "candidate_2_reasons",
  "candidate_3_agency_id",
  "candidate_3_agency_name",
  "candidate_3_score",
  "candidate_3_reasons",
  "selected_agency_id",
  "decision",
  "notes",
];

const main = async () => {
  ensureDir(REFERENCE_DIR);
  ensureDir(REPORTS_DIR);

  if (!fs.existsSync(DB_MAP_JSON)) {
    throw new Error(`agency_db_map_missing:${relativeFromRoot(DB_MAP_JSON)}`);
  }

  const job = readJson(JOB_FILE);
  const dbMapRows = readJson(DB_MAP_JSON);
  const leadSources = loadLeadSources(job);
  const indexes = buildIndexes(dbMapRows);
  const decisions = loadDecisions();

  const totals = {
    records_total: 0,
    records_with_agency_context_total: 0,
    matched_records_total: 0,
    unmatched_records_total: 0,
    ambiguous_records_total: 0,
    manual_or_weak_records_total: 0,
    records_with_identity_total: 0,
    records_without_identity_total: 0,
    records_with_strong_identity_total: 0,
    customer_total: 0,
    discarded_total: 0,
    active_total: 0,
    approved_manual_records_total: 0,
  };

  const overallState = createSummaryState();
  const byAgencyState = new Map();
  const byContactState = new Map();
  const unmatchedAgencies = new Map();
  const reviewQueue = new Map();

  for (const source of leadSources) {
    const table = readCsvTable(source.absolutePath, Number(source.header_row ?? 0) || null);
    const leadRows = table.rows.map((row) => buildLeadRecord(source, row));

    leadRows.forEach((lead) => {
      const hasAgencyContext = Boolean(normalizeName(lead.agency_name) || normalizeName(lead.agent_name));
      if (!hasAgencyContext) return;

      totals.records_total += 1;
      totals.records_with_agency_context_total += 1;
      overallState.attributed_records_total += 1;

      const hasIdentity = Boolean(txt(lead.lead_name) || txt(lead.email) || txt(lead.phone));
      const hasStrongIdentity = Boolean(txt(lead.email) || txt(lead.phone));
      if (hasIdentity) {
        totals.records_with_identity_total += 1;
        overallState.records_with_identity_total += 1;
      } else {
        totals.records_without_identity_total += 1;
        overallState.records_without_identity_total += 1;
      }
      if (hasStrongIdentity) {
        totals.records_with_strong_identity_total += 1;
        overallState.records_with_strong_identity_total += 1;
      }

      const statusInfo = classifyStatus(lead.status);
      bumpStatusTotals(totals, statusInfo.status_class);
      bumpStatusTotals(overallState, statusInfo.status_class);
      overallState.statuses.set(statusInfo.status_label, (overallState.statuses.get(statusInfo.status_label) ?? 0) + 1);

      const recordMonthKey = monthKey(lead.intake_date);
      addMonthlyTotals(overallState, recordMonthKey, {
        hasIdentity,
        statusClass: statusInfo.status_class,
      });
      addProjectTotals(overallState, lead.project_label, lead.project_legacy_code, {
        hasIdentity,
        statusClass: statusInfo.status_class,
      });
      addSourceFileTotal(overallState, lead.source_file);
      addSampleLeadName(overallState, lead.lead_name);

      const reviewKey = reviewKeyFromLead(lead);
      const match = resolveAgencyMatch(lead, indexes);
      const manualDecision = decisions.get(reviewKey) ?? null;
      const approvedAgencyId =
        manualDecision?.decision === "approve" && txt(manualDecision.selected_agency_id)
          ? txt(manualDecision.selected_agency_id)
          : null;
      const effectiveAgencyId =
        approvedAgencyId && indexes.agencyInfoById.has(approvedAgencyId) ? approvedAgencyId : match.agency_id;
      const effectiveMatchStatus =
        approvedAgencyId && indexes.agencyInfoById.has(approvedAgencyId) ? "approved_manual" : match.match_status;

      if (match.match_status === "ambiguous" || match.match_status === "manual" || match.match_status === "weak") {
        const current = reviewQueue.get(reviewKey) ?? {
          review_key: reviewKey,
          match_status: match.match_status,
          project_label: lead.project_label ?? "",
          project_legacy_code: lead.project_legacy_code ?? "",
          lead_agency_name: lead.agency_name ?? "",
          lead_agent_name: lead.agent_name ?? "",
          records_total: 0,
          records_with_identity_total: 0,
          records_with_strong_identity_total: 0,
          customer_total: 0,
          discarded_total: 0,
          active_total: 0,
          sample_lead_names: [],
          candidates: match.candidates.slice(0, 3),
          selected_agency_id: approvedAgencyId ?? "",
          decision: manualDecision?.decision ?? "",
          notes: manualDecision?.notes ?? "",
        };
        current.records_total += 1;
        if (hasIdentity) current.records_with_identity_total += 1;
        if (hasStrongIdentity) current.records_with_strong_identity_total += 1;
        if (statusInfo.status_class === "customer") current.customer_total += 1;
        else if (statusInfo.status_class === "discarded") current.discarded_total += 1;
        else current.active_total += 1;
        addSampleLeadName(current, lead.lead_name);
        reviewQueue.set(reviewKey, current);
      }

      if (effectiveMatchStatus === "approved_manual") {
        totals.approved_manual_records_total += 1;
        totals.matched_records_total += 1;
      } else if (effectiveMatchStatus === "ambiguous") {
        totals.ambiguous_records_total += 1;
      } else if (effectiveMatchStatus === "unmatched") {
        totals.unmatched_records_total += 1;
      } else if (effectiveMatchStatus === "manual" || effectiveMatchStatus === "weak") {
        totals.manual_or_weak_records_total += 1;
      } else {
        totals.matched_records_total += 1;
      }

      if (!effectiveAgencyId) {
        const unmatchedKey = `${lead.project_label ?? ""}|${lead.agency_name ?? lead.agent_name ?? "sin-nombre"}`;
        const current = unmatchedAgencies.get(unmatchedKey) ?? {
          review_key: reviewKey,
          project_label: lead.project_label ?? "",
          project_legacy_code: lead.project_legacy_code ?? "",
          agency_name: lead.agency_name ?? "",
          agent_name: lead.agent_name ?? "",
          total: 0,
          match_status: match.match_status,
          sample_lead_names: [],
        };
        current.total += 1;
        addSampleLeadName(current, lead.lead_name);
        unmatchedAgencies.set(unmatchedKey, current);
        return;
      }

      const agencyId = effectiveAgencyId;
      const contactMatch = resolveAgencyContactMatch(lead, agencyId, indexes);
      if (!byAgencyState.has(agencyId)) {
        const info = indexes.agencyInfoById.get(agencyId) ?? {
          agency_id: agencyId,
          agency_name: lead.agency_name ?? lead.agent_name ?? "Agencia",
          agency_names: [],
          agent_names: [],
          project_labels: [],
          project_legacy_codes: [],
          emails: [],
          phones: [],
        };
        byAgencyState.set(agencyId, {
          ...info,
          summary: createSummaryState(),
          match_statuses: new Map(),
        });
      }

      const agencyState = byAgencyState.get(agencyId);
      const summary = agencyState.summary;
      summary.attributed_records_total += 1;
      if (hasIdentity) summary.records_with_identity_total += 1;
      else summary.records_without_identity_total += 1;
      if (hasStrongIdentity) summary.records_with_strong_identity_total += 1;
      bumpStatusTotals(summary, statusInfo.status_class);
      summary.statuses.set(statusInfo.status_label, (summary.statuses.get(statusInfo.status_label) ?? 0) + 1);
      addMonthlyTotals(summary, recordMonthKey, {
        hasIdentity,
        statusClass: statusInfo.status_class,
      });
      addProjectTotals(summary, lead.project_label, lead.project_legacy_code, {
        hasIdentity,
        statusClass: statusInfo.status_class,
      });
      addSourceFileTotal(summary, lead.source_file);
      addSampleLeadName(summary, lead.lead_name);
      agencyState.match_statuses.set(
        effectiveMatchStatus,
        (agencyState.match_statuses.get(effectiveMatchStatus) ?? 0) + 1
      );
      pushUnique(agencyState.project_labels, lead.project_label);
      pushUnique(agencyState.project_legacy_codes, lead.project_legacy_code);
      pushUnique(agencyState.agency_names, lead.agency_name);
      pushUnique(agencyState.agent_names, lead.agent_name);

      const agencyContactId = contactMatch.agency_contact_id;
      if (agencyContactId) {
        if (!byContactState.has(agencyContactId)) {
          const agencyCandidates = indexes.contactCandidatesByAgencyId.get(agencyId) ?? [];
          const contactCandidate = agencyCandidates.find((row) => row.agency_contact_id === agencyContactId) ?? null;
          const candidateName = txt(contactCandidate?.full_name);
          const agencyDisplayName = txt(agencyState.agency_name);
          const shouldPreferLeadAgentName =
            Boolean(candidateName) &&
            Boolean(agencyDisplayName) &&
            isLooseNameMatch(normalizeName(candidateName), normalizeName(agencyDisplayName));
          byContactState.set(agencyContactId, {
            agency_contact_id: agencyContactId,
            agency_id: agencyId,
            agency_name: agencyState.agency_name,
            full_name:
              (shouldPreferLeadAgentName ? txt(lead.agent_name) : candidateName) ??
              txt(lead.agent_name) ??
              "Contacto agencia",
            summary: createSummaryState(),
            customer_name_samples: [],
          });
        }

        const contactState = byContactState.get(agencyContactId);
        const summaryState = contactState.summary;
        summaryState.attributed_records_total += 1;
        if (hasIdentity) summaryState.records_with_identity_total += 1;
        else summaryState.records_without_identity_total += 1;
        if (hasStrongIdentity) summaryState.records_with_strong_identity_total += 1;
        bumpStatusTotals(summaryState, statusInfo.status_class);
        summaryState.statuses.set(statusInfo.status_label, (summaryState.statuses.get(statusInfo.status_label) ?? 0) + 1);
        addMonthlyTotals(summaryState, recordMonthKey, {
          hasIdentity,
          statusClass: statusInfo.status_class,
        });
        addProjectTotals(summaryState, lead.project_label, lead.project_legacy_code, {
          hasIdentity,
          statusClass: statusInfo.status_class,
        });
        addSourceFileTotal(summaryState, lead.source_file);
        addSampleLeadName(summaryState, lead.lead_name);
        if (statusInfo.status_class === "customer" && txt(lead.lead_name)) {
          pushUnique(contactState.customer_name_samples, txt(lead.lead_name));
        }
      }
    });
  }

  const byAgency = [...byAgencyState.values()]
    .map((state) => {
      const summary = finalizeSummaryState(state.summary);
      const exactMatches = state.match_statuses.get("exact") ?? 0;
      const candidateMatches = state.match_statuses.get("candidate") ?? 0;
      const approvedManualMatches = state.match_statuses.get("approved_manual") ?? 0;
      return {
        agency_id: state.agency_id,
        agency_name: state.agency_name,
        project_labels: state.project_labels,
        project_legacy_codes: state.project_legacy_codes,
        agency_names: state.agency_names,
        agent_names: state.agent_names,
        exact_matches_total: exactMatches,
        candidate_matches_total: candidateMatches,
        approved_manual_matches_total: approvedManualMatches,
        ...summary,
      };
    })
    .sort(
      (a, b) =>
        b.attributed_records_total - a.attributed_records_total ||
        b.records_with_identity_total - a.records_with_identity_total ||
        a.agency_name.localeCompare(b.agency_name, "es")
    );

  const summaryPayload = {
    generated_at: new Date().toISOString(),
    job_file: relativeFromRoot(JOB_FILE),
    db_map_json: relativeFromRoot(DB_MAP_JSON),
    decisions_csv: relativeFromRoot(DECISIONS_CSV),
    totals,
    overall: finalizeSummaryState(overallState),
    by_agency: byAgency,
    by_contact: [...byContactState.values()]
      .map((state) => ({
        agency_contact_id: state.agency_contact_id,
        agency_id: state.agency_id,
        agency_name: state.agency_name,
        full_name: state.full_name,
        customer_name_samples: state.customer_name_samples,
        ...finalizeSummaryState(state.summary),
      }))
      .sort(
        (a, b) =>
          b.attributed_records_total - a.attributed_records_total ||
          b.customer_total - a.customer_total ||
          a.full_name.localeCompare(b.full_name, "es")
      ),
    unmatched_agencies: [...unmatchedAgencies.values()]
      .map((row) => ({
        ...row,
        sample_names: row.sample_lead_names ?? [],
      }))
      .sort((a, b) => b.total - a.total || a.project_label.localeCompare(b.project_label, "es"))
      .slice(0, 100),
  };

  const agenciesCsvRows = byAgency.map((row) => ({
    agency_id: row.agency_id,
    agency_name: row.agency_name,
    project_labels: row.project_labels.join(" | "),
    attributed_records_total: row.attributed_records_total,
    records_with_identity_total: row.records_with_identity_total,
    records_without_identity_total: row.records_without_identity_total,
    records_with_strong_identity_total: row.records_with_strong_identity_total,
    customer_total: row.customer_total,
    discarded_total: row.discarded_total,
    active_total: row.active_total,
    crm_linked_leads_total: row.exact_matches_total + row.candidate_matches_total + row.approved_manual_matches_total,
  }));

  const reviewCsvRows = [...reviewQueue.values()]
    .sort(
      (a, b) =>
        b.records_total - a.records_total ||
        a.project_label.localeCompare(b.project_label, "es") ||
        a.lead_agency_name.localeCompare(b.lead_agency_name, "es")
    )
    .map((row) => {
      const candidateCells = {};
      row.candidates.slice(0, 3).forEach((candidate, index) => {
        const slot = index + 1;
        const info = indexes.agencyInfoById.get(candidate.agencyId) ?? null;
        candidateCells[`candidate_${slot}_agency_id`] = candidate.agencyId;
        candidateCells[`candidate_${slot}_agency_name`] = info?.agency_name ?? candidate.agencyId;
        candidateCells[`candidate_${slot}_score`] = candidate.score;
        candidateCells[`candidate_${slot}_reasons`] = candidate.reasons.join(" | ");
      });
      return {
        review_key: row.review_key,
        match_status: row.match_status,
        project_label: row.project_label,
        project_legacy_code: row.project_legacy_code,
        lead_agency_name: row.lead_agency_name,
        lead_agent_name: row.lead_agent_name,
        records_total: row.records_total,
        records_with_identity_total: row.records_with_identity_total,
        records_with_strong_identity_total: row.records_with_strong_identity_total,
        customer_total: row.customer_total,
        discarded_total: row.discarded_total,
        active_total: row.active_total,
        sample_lead_names: row.sample_lead_names.join(" | "),
        candidate_1_agency_id: "",
        candidate_1_agency_name: "",
        candidate_1_score: "",
        candidate_1_reasons: "",
        candidate_2_agency_id: "",
        candidate_2_agency_name: "",
        candidate_2_score: "",
        candidate_2_reasons: "",
        candidate_3_agency_id: "",
        candidate_3_agency_name: "",
        candidate_3_score: "",
        candidate_3_reasons: "",
        selected_agency_id: row.selected_agency_id,
        decision: row.decision,
        notes: row.notes,
        ...candidateCells,
      };
    });

  const runTs = timestamp();
  const summaryJson = path.join(REFERENCE_DIR, "agency-attributed-summary-latest.json");
  const agenciesCsv = path.join(REFERENCE_DIR, "agency-attributed-agencies-latest.csv");
  const reviewCsv = path.join(REFERENCE_DIR, "agency-attributed-review-queue-latest.csv");
  const reportJson = path.join(REPORTS_DIR, `agency-attributed-records-${runTs}.json`);

  writeJson(summaryJson, summaryPayload);
  writeCsv(agenciesCsv, agenciesCsvRows, agenciesCsvHeaders);
  writeCsv(reviewCsv, reviewCsvRows, reviewCsvHeaders);
  if (!fs.existsSync(DECISIONS_CSV)) writeCsv(DECISIONS_CSV, [], reviewCsvHeaders);
  writeJson(reportJson, summaryPayload);

  console.log(
    JSON.stringify(
      {
        ok: true,
        totals,
        outputs: {
          summary_json: relativeFromRoot(summaryJson),
          agencies_csv: relativeFromRoot(agenciesCsv),
          review_csv: relativeFromRoot(reviewCsv),
          decisions_csv: relativeFromRoot(DECISIONS_CSV),
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
