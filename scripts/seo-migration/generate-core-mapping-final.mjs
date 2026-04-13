import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const INPUT_PATH = path.join(__dirname, "reference", "priority_a_core.csv");
const AUDIT_PATH = path.join(REPO_ROOT, "seo_url_audit_master.csv");
const OUTPUT_PATH = path.join(__dirname, "reference", "core_mapping_final.csv");

const OUTPUT_HEADERS = [
  "old_url",
  "old_title",
  "old_type",
  "old_language",
  "suggested_new_url",
  "mapping_status",
  "mapping_type",
  "confidence",
  "notes",
];

const OVERRIDES = {
  "https://www.blancareal.com/de/steuern-haus-kaufen-spanien/": {
    suggested_new_url: "https://blancareal.com/de/post/steuern-zahlen-costa-del-sol-immobilie/",
    notes: "Matched to the live German version of the current taxes guide.",
  },
  "https://www.blancareal.com/it/tasse-comprare-casa-in-spagna/": {
    suggested_new_url: "https://blancareal.com/it/post/tasse-pagare-proprieta-costa-del-sol/",
    notes: "Matched to the live Italian version of the current taxes guide.",
  },
  "https://www.blancareal.com/es/gastos-comprar-piso-en-malaga/": {
    suggested_new_url: "https://blancareal.com/es/post/impuestos-pagar-propiedad-costa-del-sol/",
    notes: "Matched to the live Spanish version of the current taxes guide.",
  },
  "https://www.blancareal.com/fr/impots-achat-maison-en-espagne/": {
    suggested_new_url: "https://blancareal.com/fr/post/taxes-payer-propriete-costa-del-sol/",
    notes: "Matched to the live French version of the current taxes guide.",
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

function urlPath(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

function isConfirmedSectionRedirect(row, suggestedNewUrl) {
  const path = urlPath(suggestedNewUrl);
  if (row.old_url === "https://www.blancareal.com/property-search/") return true;
  if (row.old_type === "service_page" && /\/(properties|projects)\/$/.test(path) && !/\/(contact|commercialization|sell-with-us)\/$/.test(path)) {
    return row.old_url !== "https://www.blancareal.com/our-developments/" && row.old_url !== "https://www.blancareal.com/nl/onze-promoties/";
  }
  return false;
}

function inferMappingType(row, suggestedNewUrl, fromOverride) {
  if (isConfirmedSectionRedirect(row, suggestedNewUrl)) {
    return "same_section_redirect";
  }

  if (row.old_language !== "en" || row.old_type === "home" || fromOverride) {
    return "language_equivalent";
  }

  return "same_intent_direct";
}

function inferConfidence(row, mappingStatus, mappingType, fromOverride) {
  if (mappingStatus !== "confirmed") {
    return "low";
  }

  if (mappingType === "same_section_redirect") {
    return "medium";
  }

  if (fromOverride) {
    return "high";
  }

  return row.match_confidence === "high" ? "high" : "medium";
}

function inferNonConfirmedStatus(row) {
  if (row.old_type === "service_page") {
    return "needs_manual_choice";
  }
  return "missing_in_new_site";
}

function inferNonConfirmedNotes(row) {
  if (row.old_type === "service_page") {
    return "No live equivalent was confirmed; this service or section needs a manual destination choice.";
  }
  return "No live equivalent was confirmed in the current new-site routes.";
}

async function main() {
  const [inputRaw, auditRaw] = await Promise.all([
    fs.readFile(INPUT_PATH, "utf8"),
    fs.readFile(AUDIT_PATH, "utf8"),
  ]);

  const inputRows = readCsvRows(inputRaw);
  const auditRows = readCsvRows(auditRaw);
  const auditUrlSet = new Set(auditRows.map((row) => String(row.new_url ?? "").trim()).filter(Boolean));

  const rows = inputRows.map((row) => {
    const override = OVERRIDES[row.old_url] ?? null;
    const suggestedNewUrl = String(override?.suggested_new_url ?? row.new_url_candidate ?? "").trim();
    const exists = suggestedNewUrl ? auditUrlSet.has(suggestedNewUrl) : false;

    if (exists) {
      const mappingType = inferMappingType(row, suggestedNewUrl, Boolean(override));
      const notes = [];

      if (override?.notes) {
        notes.push(override.notes);
      } else if (mappingType === "same_section_redirect") {
        notes.push("Validated against a live broader section in the new site.");
      } else {
        notes.push("Validated against a live route in the new site.");
      }

      return {
        old_url: row.old_url,
        old_title: row.old_title,
        old_type: row.old_type,
        old_language: row.old_language,
        suggested_new_url: suggestedNewUrl,
        mapping_status: "confirmed",
        mapping_type: mappingType,
        confidence: inferConfidence(row, "confirmed", mappingType, Boolean(override)),
        notes: notes.join(" "),
      };
    }

    return {
      old_url: row.old_url,
      old_title: row.old_title,
      old_type: row.old_type,
      old_language: row.old_language,
      suggested_new_url: "",
      mapping_status: inferNonConfirmedStatus(row),
      mapping_type: "no_equivalent_yet",
      confidence: "low",
      notes: inferNonConfirmedNotes(row),
    };
  });

  await fs.writeFile(OUTPUT_PATH, toCsv(OUTPUT_HEADERS, rows), "utf8");

  console.log(
    JSON.stringify(
      {
        rows: rows.length,
        confirmed: rows.filter((row) => row.mapping_status === "confirmed").length,
        needs_manual_choice: rows.filter((row) => row.mapping_status === "needs_manual_choice").length,
        missing_in_new_site: rows.filter((row) => row.mapping_status === "missing_in_new_site").length,
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
