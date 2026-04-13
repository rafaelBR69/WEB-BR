import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REFERENCE_DIR = path.join(__dirname, "reference");

const CORE_PATH = path.join(REFERENCE_DIR, "redirect_map_core_final_v2.csv");
const PROPERTY_PATH = path.join(REFERENCE_DIR, "redirect_map_properties_final.csv");

const READY_OUTPUT = path.join(REFERENCE_DIR, "redirects_ready_for_implementation.csv");
const MANUAL_OUTPUT = path.join(REFERENCE_DIR, "redirects_manual_review.csv");
const FUTURE_OUTPUT = path.join(REFERENCE_DIR, "redirects_needs_future_landing.csv");

const READY_HEADERS = ["old_url", "target_url", "redirect_type", "source_group", "notes"];
const MANUAL_HEADERS = ["old_url", "target_url", "match_strategy", "notes"];
const FUTURE_HEADERS = ["old_url", "current_fallback_target", "recommendation", "notes"];

const FUTURE_LANDING_URLS = new Set([
  "https://www.blancareal.com/faqs/",
  "https://www.blancareal.com/services/",
  "https://www.blancareal.com/luxury-villas/",
  "https://www.blancareal.com/second-hand/",
  "https://www.blancareal.com/vacation/",
  "https://www.blancareal.com/rentals/",
]);

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

async function main() {
  const [coreRaw, propertyRaw] = await Promise.all([
    fs.readFile(CORE_PATH, "utf8"),
    fs.readFile(PROPERTY_PATH, "utf8"),
  ]);

  const coreRows = readCsvRows(coreRaw);
  const propertyRows = readCsvRows(propertyRaw);

  const readyRows = [
    ...coreRows
      .filter((row) => ["approved", "approved_section_fallback"].includes(row.status) && String(row.target_url ?? "").trim())
      .map((row) => ({
        old_url: row.old_url,
        target_url: row.target_url,
        redirect_type: row.redirect_type,
        source_group: "core",
        notes: row.notes,
      })),
    ...propertyRows
      .filter((row) => ["approved", "approved_section_fallback"].includes(row.status) && String(row.target_url ?? "").trim())
      .map((row) => ({
        old_url: row.old_url,
        target_url: row.target_url,
        redirect_type: row.redirect_type,
        source_group: "property",
        notes: row.notes,
      })),
  ];

  const manualRows = propertyRows
    .filter((row) => row.status === "manual_review_hold")
    .map((row) => ({
      old_url: row.old_url,
      target_url: row.target_url,
      match_strategy: row.match_strategy,
      notes: row.notes,
    }));

  const futureRows = coreRows
    .filter((row) => FUTURE_LANDING_URLS.has(row.old_url))
    .map((row) => ({
      old_url: row.old_url,
      current_fallback_target: row.target_url,
      recommendation: "create_specific_landing_later",
      notes: row.notes,
    }));

  await Promise.all([
    fs.writeFile(READY_OUTPUT, toCsv(READY_HEADERS, readyRows), "utf8"),
    fs.writeFile(MANUAL_OUTPUT, toCsv(MANUAL_HEADERS, manualRows), "utf8"),
    fs.writeFile(FUTURE_OUTPUT, toCsv(FUTURE_HEADERS, futureRows), "utf8"),
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
