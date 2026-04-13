import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const MASTER_STARTER_PATH = path.join(__dirname, "reference", "migration_master_starter.csv");
const MASTER_AUDIT_PATH = path.join(REPO_ROOT, "seo_url_audit_master.csv");
const OUTPUT_DIR = path.join(__dirname, "reference");

const PRIORITY_HEADERS = [
  "old_url",
  "old_title",
  "old_type",
  "old_language",
  "old_inlinks",
  "keep_candidate",
  "new_url_candidate",
  "match_confidence",
  "priority_reason",
  "manual_review_required",
];

const DROP_HEADERS = [
  "old_url",
  "old_title",
  "old_type",
  "old_language",
  "old_status",
  "keep_candidate",
  "suggested_action",
  "notes",
];

const PRIORITY_A_CORE_HEADERS = [
  "old_url",
  "old_title",
  "old_type",
  "old_language",
  "old_inlinks",
  "new_url_candidate",
  "match_confidence",
  "priority_reason",
  "manual_review_required",
];

const PRIORITY_A_PROPERTIES_HEADERS = [
  "old_url",
  "old_title",
  "old_language",
  "old_inlinks",
  "new_url_candidate",
  "match_confidence",
  "manual_review_required",
  "property_action_candidate",
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

function readRows(content) {
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

function toInt(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasNewCandidate(row) {
  return String(row.new_url_candidate ?? "").trim().length > 0;
}

function isMultilingualRelevant(row) {
  return (
    row.old_language !== "en" &&
    row.keep_candidate === "yes" &&
    ["service_page", "blog_index", "other"].includes(row.old_type)
  );
}

function isPriorityA(row) {
  if (["home", "service_page", "blog_index"].includes(row.old_type)) return true;
  if (row.old_type === "other" && row.keep_candidate === "yes") return true;
  if (row.old_type === "property" && (toInt(row.old_inlinks) >= 2 || row.match_confidence === "high")) return true;
  if (isMultilingualRelevant(row)) return true;
  return false;
}

function buildPriorityReason(row) {
  if (row.old_type === "home") {
    return "Core homepage migration candidate.";
  }

  if (row.old_type === "service_page") {
    return "Core service or transactional page.";
  }

  if (row.old_type === "blog_index") {
    return "Editorial index with clear migration relevance.";
  }

  if (row.old_type === "other" && row.keep_candidate === "yes" && row.old_language !== "en") {
    return "Relevant multilingual informational or commercial page.";
  }

  if (row.old_type === "other" && row.keep_candidate === "yes") {
    return "Informational or business page that should be reviewed early.";
  }

  if (row.old_type === "property" && row.match_confidence === "high") {
    return "Property with high-confidence candidate already identified.";
  }

  if (row.old_type === "property" && toInt(row.old_inlinks) >= 2) {
    return "Property with stronger internal-link signal in the old site.";
  }

  return "Lower-priority keep candidate pending later review.";
}

function buildManualReview(row, existingNewUrls) {
  if (row.old_type === "property") return "yes";
  if (!hasNewCandidate(row)) return "yes";
  if (!existingNewUrls.has(row.new_url_candidate)) return "yes";
  return "no";
}

function buildPriorityRow(row, existingNewUrls) {
  return {
    old_url: row.old_url,
    old_title: row.old_title,
    old_type: row.old_type,
    old_language: row.old_language,
    old_inlinks: row.old_inlinks,
    keep_candidate: row.keep_candidate,
    new_url_candidate: row.new_url_candidate,
    match_confidence: row.match_confidence,
    priority_reason: buildPriorityReason(row),
    manual_review_required: buildManualReview(row, existingNewUrls),
  };
}

function buildSuggestedAction(row) {
  const notes = String(row.notes ?? "");
  const status = String(row.old_status ?? "");
  const isDuplicate = /Obvious duplicate of|Canonical legacy counterpart:/i.test(notes);

  if (isDuplicate) {
    return "redirect_to_canonical";
  }

  if (["category", "tag", "blog_pagination"].includes(row.old_type)) {
    return "consolidate";
  }

  if (row.old_type === "legal" && row.keep_candidate === "no") {
    return "legal_keep_noindex";
  }

  if (status === "301" || status === "404") {
    return "ignore_legacy_404";
  }

  if (row.keep_candidate === "no" && /non-indexable/i.test(row.reason ?? "")) {
    return "review_manually";
  }

  return "review_manually";
}

function buildDropRow(row) {
  return {
    old_url: row.old_url,
    old_title: row.old_title,
    old_type: row.old_type,
    old_language: row.old_language,
    old_status: row.old_status,
    keep_candidate: row.keep_candidate,
    suggested_action: buildSuggestedAction(row),
    notes: row.notes,
  };
}

function looksProjectOrPromotionLike(row) {
  const haystack = `${row.old_url} ${row.old_title}`.toLowerCase();
  return /offplan|new development|new[- ]construction|project|promot|promotion|promocion|promotions/.test(
    haystack
  );
}

function buildPriorityACoreRow(row) {
  return {
    old_url: row.old_url,
    old_title: row.old_title,
    old_type: row.old_type,
    old_language: row.old_language,
    old_inlinks: row.old_inlinks,
    new_url_candidate: row.new_url_candidate,
    match_confidence: row.match_confidence,
    priority_reason: row.priority_reason,
    manual_review_required: row.manual_review_required,
  };
}

function buildPropertyActionCandidate(row, existingNewUrls) {
  const newUrlCandidate = String(row.new_url_candidate ?? "").trim();
  const inlinks = toInt(row.old_inlinks);

  if (newUrlCandidate && existingNewUrls.has(newUrlCandidate)) {
    if (newUrlCandidate.includes("/property/")) {
      return "map_to_existing_new_property";
    }
    if (newUrlCandidate.includes("/projects/")) {
      return "redirect_to_projects_index";
    }
    if (newUrlCandidate.includes("/properties/")) {
      return "redirect_to_properties_index";
    }
  }

  if (looksProjectOrPromotionLike(row)) {
    return "redirect_to_projects_index";
  }

  if (inlinks >= 2) {
    return "redirect_to_properties_index";
  }

  if (!newUrlCandidate && inlinks <= 1) {
    return "drop_if_not_in_new_site";
  }

  return "manual_review";
}

function buildPriorityAPropertyRow(row, existingNewUrls, starterByUrl) {
  const starterRow = starterByUrl.get(row.old_url) ?? {};

  return {
    old_url: row.old_url,
    old_title: row.old_title,
    old_language: row.old_language,
    old_inlinks: row.old_inlinks,
    new_url_candidate: row.new_url_candidate,
    match_confidence: row.match_confidence,
    manual_review_required: row.manual_review_required,
    property_action_candidate: buildPropertyActionCandidate(row, existingNewUrls),
    notes: starterRow.notes ?? "",
  };
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const [starterRaw, auditRaw] = await Promise.all([
    fs.readFile(MASTER_STARTER_PATH, "utf8"),
    fs.readFile(MASTER_AUDIT_PATH, "utf8"),
  ]);

  const starterRows = readRows(starterRaw);
  const auditRows = readRows(auditRaw);
  const existingNewUrls = new Set(auditRows.map((row) => row.new_url).filter(Boolean));
  const starterByUrl = new Map(starterRows.map((row) => [row.old_url, row]));

  const keepYesRows = starterRows.filter((row) => row.keep_candidate === "yes");
  const priorityARows = keepYesRows.filter(isPriorityA).map((row) => buildPriorityRow(row, existingNewUrls));
  const priorityBRows = keepYesRows.filter((row) => !isPriorityA(row)).map((row) => buildPriorityRow(row, existingNewUrls));
  const dropRows = starterRows
    .filter((row) => row.keep_candidate === "maybe" || row.keep_candidate === "no")
    .map(buildDropRow);
  const priorityACoreRows = priorityARows
    .filter((row) => row.old_type !== "property")
    .map(buildPriorityACoreRow);
  const priorityAPropertyRows = priorityARows
    .filter((row) => row.old_type === "property")
    .map((row) => buildPriorityAPropertyRow(row, existingNewUrls, starterByUrl));

  await Promise.all([
    fs.writeFile(path.join(OUTPUT_DIR, "migration_priority_a.csv"), toCsv(PRIORITY_HEADERS, priorityARows), "utf8"),
    fs.writeFile(path.join(OUTPUT_DIR, "migration_priority_b.csv"), toCsv(PRIORITY_HEADERS, priorityBRows), "utf8"),
    fs.writeFile(path.join(OUTPUT_DIR, "migration_drop_or_consolidate.csv"), toCsv(DROP_HEADERS, dropRows), "utf8"),
    fs.writeFile(path.join(OUTPUT_DIR, "priority_a_core.csv"), toCsv(PRIORITY_A_CORE_HEADERS, priorityACoreRows), "utf8"),
    fs.writeFile(
      path.join(OUTPUT_DIR, "priority_a_properties.csv"),
      toCsv(PRIORITY_A_PROPERTIES_HEADERS, priorityAPropertyRows),
      "utf8"
    ),
  ]);

  console.log(
    JSON.stringify(
      {
        priority_a: priorityARows.length,
        priority_a_core: priorityACoreRows.length,
        priority_a_properties: priorityAPropertyRows.length,
        priority_b: priorityBRows.length,
        drop_or_consolidate: dropRows.length,
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
