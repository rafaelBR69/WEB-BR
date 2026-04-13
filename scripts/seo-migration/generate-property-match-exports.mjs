import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const MATCHING_REVIEW_PATH = path.join(__dirname, "reference", "properties_matching_review.csv");
const MASTER_AUDIT_PATH = path.join(REPO_ROOT, "seo_url_audit_master.csv");
const OUTPUT_DIR = path.join(__dirname, "reference");

const HIGH_CONFIDENCE_HEADERS = [
  "old_url",
  "old_title",
  "suggested_new_url",
  "matched_json_id",
  "matched_title",
  "matched_location",
  "matched_property_type",
  "match_score",
  "match_basis",
  "notes",
];

const MANUAL_REVIEW_HEADERS = [...HIGH_CONFIDENCE_HEADERS];

const FALLBACK_HEADERS = [
  "old_url",
  "old_title",
  "decision",
  "suggested_fallback_url",
  "notes",
];

function stripBom(value) {
  return value.replace(/^\uFEFF/, "");
}

function parseCsv(content) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  const normalized = stripBom(content);

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (inQuotes) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

function readCsvRows(content) {
  const parsed = parseCsv(content);
  const [headerRow, ...dataRows] = parsed;

  return dataRows
    .filter((row) => row.some((value) => String(value ?? "").trim().length > 0))
    .map((row) => {
      const record = {};
      headerRow.forEach((header, index) => {
        record[header] = row[index] ?? "";
      });
      return record;
    });
}

function csvEscape(value) {
  const normalized = String(value ?? "");
  if (/[",\n\r]/.test(normalized)) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
}

function toCsv(headers, rows) {
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
}

function inferLanguageFromOldUrl(oldUrl) {
  try {
    const pathname = new URL(oldUrl).pathname;
    const langMatch = pathname.match(/^\/(es|de|fr|it|nl)\//i);
    return langMatch ? langMatch[1].toLowerCase() : "en";
  } catch {
    return "en";
  }
}

function buildIndexMap(auditRows) {
  const map = new Map();

  for (const row of auditRows) {
    const url = String(row.new_url ?? "").trim();
    const lang = String(row.lang ?? "").trim().toLowerCase();
    const entitySlug = String(row.entity_slug ?? "").trim();

    if (!url || !lang) continue;

    if (entitySlug === "properties" && !map.has(`properties:${lang}`)) {
      map.set(`properties:${lang}`, url);
    }

    if (entitySlug === "projects" && !map.has(`projects:${lang}`)) {
      map.set(`projects:${lang}`, url);
    }
  }

  return map;
}

function pickFallbackUrl(decision, oldUrl, indexMap) {
  const lang = inferLanguageFromOldUrl(oldUrl);

  if (decision === "redirect_to_projects_index") {
    return (
      indexMap.get(`projects:${lang}`) ??
      indexMap.get("projects:en") ??
      ""
    );
  }

  if (decision === "redirect_to_properties_index") {
    return (
      indexMap.get(`properties:${lang}`) ??
      indexMap.get("properties:en") ??
      ""
    );
  }

  return "";
}

async function main() {
  const [matchingRaw, auditRaw] = await Promise.all([
    fs.readFile(MATCHING_REVIEW_PATH, "utf8"),
    fs.readFile(MASTER_AUDIT_PATH, "utf8"),
  ]);

  const matchingRows = readCsvRows(matchingRaw);
  const auditRows = readCsvRows(auditRaw);
  const indexMap = buildIndexMap(auditRows);

  const highConfidenceRows = matchingRows
    .filter((row) => row.decision === "map_to_existing_new_property")
    .map((row) => Object.fromEntries(HIGH_CONFIDENCE_HEADERS.map((header) => [header, row[header] ?? ""])));

  const manualReviewRows = matchingRows
    .filter((row) => row.decision === "manual_review")
    .map((row) => Object.fromEntries(MANUAL_REVIEW_HEADERS.map((header) => [header, row[header] ?? ""])));

  const fallbackRows = matchingRows
    .filter((row) => row.decision === "redirect_to_properties_index" || row.decision === "redirect_to_projects_index")
    .map((row) => ({
      old_url: row.old_url ?? "",
      old_title: row.old_title ?? "",
      decision: row.decision ?? "",
      suggested_fallback_url: pickFallbackUrl(row.decision, row.old_url, indexMap),
      notes: row.notes ?? "",
    }));

  await Promise.all([
    fs.writeFile(
      path.join(OUTPUT_DIR, "property_matches_high_confidence.csv"),
      toCsv(HIGH_CONFIDENCE_HEADERS, highConfidenceRows),
      "utf8"
    ),
    fs.writeFile(
      path.join(OUTPUT_DIR, "property_matches_manual_review.csv"),
      toCsv(MANUAL_REVIEW_HEADERS, manualReviewRows),
      "utf8"
    ),
    fs.writeFile(
      path.join(OUTPUT_DIR, "property_fallback_indexes.csv"),
      toCsv(FALLBACK_HEADERS, fallbackRows),
      "utf8"
    ),
  ]);

  console.log(
    JSON.stringify(
      {
        high_confidence: highConfidenceRows.length,
        manual_review: manualReviewRows.length,
        fallback_indexes: fallbackRows.length,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
