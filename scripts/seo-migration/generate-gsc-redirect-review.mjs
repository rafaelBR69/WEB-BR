import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REFERENCE_DIR = path.join(__dirname, "reference");

const GSC_PAGES_PATH = path.join(REFERENCE_DIR, "Páginas.csv");
const CORE_REDIRECTS_PATH = path.join(REFERENCE_DIR, "redirect_map_core_final_v2.csv");
const PROPERTY_REDIRECTS_PATH = path.join(REFERENCE_DIR, "redirect_map_properties_final.csv");

const PRIORITY_OUTPUT = path.join(REFERENCE_DIR, "gsc_priority_urls.csv");
const RISK_OUTPUT = path.join(REFERENCE_DIR, "redirects_risk_review.csv");
const SAFE_OUTPUT = path.join(REFERENCE_DIR, "redirects_safe_to_launch.csv");

const PRIORITY_HEADERS = [
  "old_url",
  "clicks",
  "impressions",
  "ctr",
  "position",
  "redirect_target",
  "redirect_status",
  "migration_priority",
  "notes",
];

const RISK_HEADERS = [
  "old_url",
  "clicks",
  "impressions",
  "redirect_target",
  "risk_reason",
  "recommendation",
];

const SAFE_HEADERS = [
  "old_url",
  "redirect_target",
  "redirect_type",
  "final_status",
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

function canonicalHeader(value) {
  return stripBom(String(value ?? ""))
    .trim()
    .toLowerCase()
    .replace(/Ã¡|á/g, "a")
    .replace(/Ã©|é/g, "e")
    .replace(/Ã­|í/g, "i")
    .replace(/Ã³|ó/g, "o")
    .replace(/Ãº|ú/g, "u")
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function readCsvRows(content) {
  const parsed = parseCsv(content);
  const [headerRow, ...dataRows] = parsed;
  const headers = headerRow.map((header) => canonicalHeader(header));

  return dataRows
    .filter((row) => row.some((value) => String(value ?? "").trim().length > 0))
    .map((row) => {
      const record = {};
      headers.forEach((header, index) => {
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

function normalizeUrl(value) {
  const input = String(value ?? "").trim();
  if (!input) {
    return "";
  }

  try {
    const url = new URL(input);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if (!url.pathname) {
      url.pathname = "/";
    }
    if (!path.posix.extname(url.pathname) && !url.pathname.endsWith("/")) {
      url.pathname = `${url.pathname}/`;
    }
    return url.toString();
  } catch {
    return input;
  }
}

function parseInteger(value) {
  const normalized = String(value ?? "").replace(/[^\d.-]/g, "");
  if (!normalized) {
    return null;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDecimal(value) {
  const normalized = String(value ?? "").replace("%", "").replace(",", ".").trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isGeneralIndexTarget(url) {
  return /\/(posts|properties|projects)\/?$/.test(String(url ?? "").trim());
}

function getRedirectStatus(row) {
  if (!row) {
    return "missing_redirect";
  }
  if (row.status === "manual_review_hold") {
    return "manual_review_hold";
  }
  if (!String(row.target_url ?? "").trim()) {
    return "missing_redirect";
  }
  if (row.status === "approved_section_fallback" || isGeneralIndexTarget(row.target_url)) {
    return "section_fallback";
  }
  return "exact_or_strong_match";
}

function getMigrationPriority(clicks, impressions) {
  if ((clicks ?? 0) >= 20 || (impressions ?? 0) >= 1000) {
    return "critical";
  }
  if ((clicks ?? 0) > 0 || (impressions ?? 0) >= 50) {
    return "medium";
  }
  return "low";
}

function compareBySignalDescending(left, right) {
  const leftPriority = { critical: 3, medium: 2, low: 1 }[left.migration_priority] ?? 0;
  const rightPriority = { critical: 3, medium: 2, low: 1 }[right.migration_priority] ?? 0;
  if (rightPriority !== leftPriority) {
    return rightPriority - leftPriority;
  }
  if ((right.clicks ?? 0) !== (left.clicks ?? 0)) {
    return (right.clicks ?? 0) - (left.clicks ?? 0);
  }
  if ((right.impressions ?? 0) !== (left.impressions ?? 0)) {
    return (right.impressions ?? 0) - (left.impressions ?? 0);
  }
  return String(left.old_url).localeCompare(String(right.old_url));
}

function buildPriorityNotes(gscRow, redirectRow, redirectStatus) {
  const notes = [];

  if (!gscRow) {
    notes.push("Not found in Paginas.csv.");
  } else {
    notes.push("Found in Paginas.csv.");
  }

  if (!redirectRow) {
    notes.push("No redirect is planned yet for this URL.");
  } else if (redirectStatus === "manual_review_hold") {
    notes.push("Current redirect plan is still on manual review hold.");
  } else if (redirectStatus === "section_fallback") {
    notes.push("Current redirect plan points to a broader section fallback.");
  } else if (redirectStatus === "exact_or_strong_match") {
    notes.push("Current redirect plan points to a direct or strong equivalent.");
  } else {
    notes.push("Redirect target is still missing in the current plan.");
  }

  return notes.join(" ");
}

async function main() {
  const [gscPagesRaw, coreRaw, propertyRaw] = await Promise.all([
    fs.readFile(GSC_PAGES_PATH, "utf8"),
    fs.readFile(CORE_REDIRECTS_PATH, "utf8"),
    fs.readFile(PROPERTY_REDIRECTS_PATH, "utf8"),
  ]);

  const gscRows = readCsvRows(gscPagesRaw);
  const coreRows = readCsvRows(coreRaw);
  const propertyRows = readCsvRows(propertyRaw);

  const redirectRows = [...coreRows, ...propertyRows];
  const redirectMap = new Map(
    redirectRows.map((row) => [
      normalizeUrl(row.old_url),
      {
        ...row,
        old_url: normalizeUrl(row.old_url),
        target_url: String(row.target_url ?? "").trim(),
      },
    ]),
  );

  const gscMap = new Map(
    gscRows.map((row) => [
      normalizeUrl(row.paginas_principales),
      {
        old_url: normalizeUrl(row.paginas_principales),
        clicks: parseInteger(row.clics),
        impressions: parseInteger(row.impresiones),
        ctr: String(row.ctr ?? "").trim(),
        position: String(row.posicion ?? row.posicionn ?? "").trim(),
      },
    ]),
  );

  const allUrls = new Set([...redirectMap.keys(), ...gscMap.keys()].filter(Boolean));

  const priorityRows = [...allUrls]
    .map((oldUrl) => {
      const redirectRow = redirectMap.get(oldUrl) ?? null;
      const gscRow = gscMap.get(oldUrl) ?? null;
      const redirectStatus = getRedirectStatus(redirectRow);
      const migrationPriority = getMigrationPriority(gscRow?.clicks ?? null, gscRow?.impressions ?? null);

      return {
        old_url: oldUrl,
        clicks: gscRow?.clicks ?? "",
        impressions: gscRow?.impressions ?? "",
        ctr: gscRow?.ctr ?? "",
        position: gscRow?.position ?? "",
        redirect_target: redirectRow?.target_url ?? "",
        redirect_status: redirectStatus,
        migration_priority: migrationPriority,
        notes: buildPriorityNotes(gscRow, redirectRow, redirectStatus),
      };
    })
    .sort(compareBySignalDescending);

  const riskRows = redirectRows
    .map((row) => {
      const normalizedUrl = normalizeUrl(row.old_url);
      const gscRow = gscMap.get(normalizedUrl);
      const hasSignal = Boolean((gscRow?.clicks ?? 0) > 0 || (gscRow?.impressions ?? 0) > 0);
      const isManualHold = row.status === "manual_review_hold";
      const isBroadIndex = isGeneralIndexTarget(row.target_url);

      if (!hasSignal || (!isManualHold && !isBroadIndex)) {
        return null;
      }

      let riskReason = "";
      let recommendation = "";

      if (isManualHold) {
        riskReason = "Traffic-bearing URL is still on manual review hold.";
        recommendation = "Resolve the property match manually before launch.";
      } else {
        riskReason = "Traffic-bearing URL redirects only to a broad index page.";
        recommendation = "Review whether a more specific destination can be assigned before launch.";
      }

      return {
        old_url: normalizedUrl,
        clicks: gscRow?.clicks ?? "",
        impressions: gscRow?.impressions ?? "",
        redirect_target: row.target_url,
        risk_reason: riskReason,
        recommendation,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if ((right.clicks ?? 0) !== (left.clicks ?? 0)) {
        return (right.clicks ?? 0) - (left.clicks ?? 0);
      }
      if ((right.impressions ?? 0) !== (left.impressions ?? 0)) {
        return (right.impressions ?? 0) - (left.impressions ?? 0);
      }
      return String(left.old_url).localeCompare(String(right.old_url));
    });

  const riskyUrls = new Set(riskRows.map((row) => row.old_url));

  const safeRows = redirectRows
    .map((row) => {
      const normalizedUrl = normalizeUrl(row.old_url);

      if (!String(row.target_url ?? "").trim() || row.status === "manual_review_hold" || riskyUrls.has(normalizedUrl)) {
        return null;
      }

      const isSectionFallback = row.status === "approved_section_fallback" || isGeneralIndexTarget(row.target_url);

      return {
        old_url: normalizedUrl,
        redirect_target: row.target_url,
        redirect_type: row.redirect_type,
        final_status: isSectionFallback ? "ready_with_accepted_fallback" : "ready_to_launch",
        notes: row.notes,
      };
    })
    .filter(Boolean)
    .sort((left, right) => String(left.old_url).localeCompare(String(right.old_url)));

  await Promise.all([
    fs.writeFile(PRIORITY_OUTPUT, toCsv(PRIORITY_HEADERS, priorityRows), "utf8"),
    fs.writeFile(RISK_OUTPUT, toCsv(RISK_HEADERS, riskRows), "utf8"),
    fs.writeFile(SAFE_OUTPUT, toCsv(SAFE_HEADERS, safeRows), "utf8"),
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
