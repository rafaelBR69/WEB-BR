import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REFERENCE_DIR = path.join(__dirname, "reference");

const CORE_MAPPING_PATH = path.join(REFERENCE_DIR, "core_mapping_final.csv");
const PROPERTY_HIGH_PATH = path.join(REFERENCE_DIR, "property_matches_high_confidence.csv");
const PROPERTY_MANUAL_PATH = path.join(REFERENCE_DIR, "property_matches_manual_review.csv");
const PROPERTY_FALLBACK_PATH = path.join(REFERENCE_DIR, "property_fallback_indexes.csv");

const CORE_OUTPUT_PATH = path.join(REFERENCE_DIR, "redirect_map_core_final_v2.csv");
const PROPERTY_OUTPUT_PATH = path.join(REFERENCE_DIR, "redirect_map_properties_final.csv");

const CORE_HEADERS = ["old_url", "target_url", "redirect_type", "reason", "status", "notes"];
const PROPERTY_HEADERS = ["old_url", "target_url", "redirect_type", "match_strategy", "status", "notes"];

const POSTS_INDEX_BY_LANG = {
  en: "https://blancareal.com/en/posts/",
  es: "https://blancareal.com/es/posts/",
  de: "https://blancareal.com/de/posts/",
  fr: "https://blancareal.com/fr/posts/",
  it: "https://blancareal.com/it/posts/",
  nl: "https://blancareal.com/nl/posts/",
};

const MANUAL_SERVICE_FALLBACKS = {
  "https://www.blancareal.com/faqs/": {
    target_url: "https://blancareal.com/en/contact/",
    reason: "provisional section fallback selected to avoid empty redirect target",
    status: "approved_section_fallback",
    notes: "fallback chosen manually during migration planning; create a more specific landing later if needed",
  },
  "https://www.blancareal.com/new-construction/": {
    target_url: "https://blancareal.com/en/projects/",
    reason: "No like-for-like page exists, but the live projects section is the closest section-level equivalent for new-construction intent.",
    status: "approved_section_fallback",
  },
  "https://www.blancareal.com/services/": {
    target_url: "https://blancareal.com/en/contact/",
    reason: "provisional section fallback selected to avoid empty redirect target",
    status: "approved_section_fallback",
    notes: "fallback chosen manually during migration planning; create a more specific landing later if needed",
  },
  "https://www.blancareal.com/luxury-villas/": {
    target_url: "https://blancareal.com/en/properties/",
    reason: "provisional section fallback selected to avoid empty redirect target",
    status: "approved_section_fallback",
    notes: "fallback chosen manually during migration planning; create a more specific landing later if needed",
  },
  "https://www.blancareal.com/second-hand/": {
    target_url: "https://blancareal.com/en/properties/",
    reason: "provisional section fallback selected to avoid empty redirect target",
    status: "approved_section_fallback",
    notes: "fallback chosen manually during migration planning; create a more specific landing later if needed",
  },
  "https://www.blancareal.com/vacation/": {
    target_url: "https://blancareal.com/en/contact/",
    reason: "provisional section fallback selected to avoid empty redirect target",
    status: "approved_section_fallback",
    notes: "fallback chosen manually during migration planning; create a more specific landing later if needed",
  },
  "https://www.blancareal.com/rentals/": {
    target_url: "https://blancareal.com/en/contact/",
    reason: "provisional section fallback selected to avoid empty redirect target",
    status: "approved_section_fallback",
    notes: "fallback chosen manually during migration planning; create a more specific landing later if needed",
  },
};

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

function buildCoreRedirectRows(coreRows) {
  return coreRows.map((row) => {
    if (row.mapping_status === "confirmed") {
      const isSection = row.mapping_type === "same_section_redirect";
      return {
        old_url: row.old_url,
        target_url: row.suggested_new_url,
        redirect_type: "301",
        reason: isSection ? "Confirmed fallback to a broader live section." : "Confirmed equivalent live destination.",
        status: "approved",
        notes: row.notes,
      };
    }

    if (row.mapping_status === "needs_manual_choice") {
      const fallback = MANUAL_SERVICE_FALLBACKS[row.old_url];
      if (fallback) {
        return {
          old_url: row.old_url,
          target_url: fallback.target_url,
          redirect_type: "301",
          reason: fallback.reason,
          status: fallback.status,
          notes: fallback.notes ?? row.notes,
        };
      }

      return {
        old_url: row.old_url,
        target_url: "",
        redirect_type: "301",
        reason: "No clearly equivalent live section was confirmed.",
        status: "needs_content_creation",
        notes: row.notes,
      };
    }

    const postsIndex = POSTS_INDEX_BY_LANG[row.old_language] ?? "";
    if (row.old_type === "other" && postsIndex) {
      return {
        old_url: row.old_url,
        target_url: postsIndex,
        redirect_type: "301",
        reason: "No live article equivalent exists; fallback to the live editorial index for the same language.",
        status: "approved_section_fallback",
        notes: row.notes,
      };
    }

    return {
      old_url: row.old_url,
      target_url: "",
      redirect_type: "301",
      reason: "No clearly valid live destination was confirmed.",
      status: "needs_content_creation",
      notes: row.notes,
    };
  });
}

function buildPropertyRedirectRows(highRows, manualRows, fallbackRows) {
  const rows = [];

  for (const row of highRows) {
    const hasMismatch = /type mismatch/i.test(row.notes);
    const hasAmbiguity = /top candidates are close|ambig/i.test(row.notes);

    rows.push({
      old_url: row.old_url,
      target_url: row.suggested_new_url,
      redirect_type: "301",
      match_strategy: "exact_property_match",
      status: hasMismatch || hasAmbiguity ? "manual_review_hold" : "approved",
      notes: row.notes,
    });
  }

  for (const row of manualRows) {
    rows.push({
      old_url: row.old_url,
      target_url: row.suggested_new_url,
      redirect_type: "301",
      match_strategy: "manual_review_hold",
      status: "manual_review_hold",
      notes: row.notes,
    });
  }

  for (const row of fallbackRows) {
    rows.push({
      old_url: row.old_url,
      target_url: row.suggested_fallback_url,
      redirect_type: "301",
      match_strategy: row.decision === "redirect_to_projects_index" ? "projects_index_fallback" : "properties_index_fallback",
      status: "approved_section_fallback",
      notes: row.notes,
    });
  }

  return rows;
}

async function main() {
  const [coreRaw, highRaw, manualRaw, fallbackRaw] = await Promise.all([
    fs.readFile(CORE_MAPPING_PATH, "utf8"),
    fs.readFile(PROPERTY_HIGH_PATH, "utf8"),
    fs.readFile(PROPERTY_MANUAL_PATH, "utf8"),
    fs.readFile(PROPERTY_FALLBACK_PATH, "utf8"),
  ]);

  const coreRows = readCsvRows(coreRaw);
  const highRows = readCsvRows(highRaw);
  const manualRows = readCsvRows(manualRaw);
  const fallbackRows = readCsvRows(fallbackRaw);

  const coreRedirectRows = buildCoreRedirectRows(coreRows);
  const propertyRedirectRows = buildPropertyRedirectRows(highRows, manualRows, fallbackRows);

  await Promise.all([
    fs.writeFile(CORE_OUTPUT_PATH, toCsv(CORE_HEADERS, coreRedirectRows), "utf8"),
    fs.writeFile(PROPERTY_OUTPUT_PATH, toCsv(PROPERTY_HEADERS, propertyRedirectRows), "utf8"),
  ]);

  console.log(
    JSON.stringify(
      {
        core_rows: coreRedirectRows.length,
        property_rows: propertyRedirectRows.length,
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
