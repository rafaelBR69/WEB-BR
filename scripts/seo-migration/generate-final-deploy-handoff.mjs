import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REFERENCE_DIR = path.join(__dirname, "reference");
const MIGRATION_DIR = path.join(REPO_ROOT, "migration");
const OPS_DIR = path.join(REPO_ROOT, "ops", "nginx");

const CORE_PATH = path.join(REFERENCE_DIR, "redirect_map_core_final_v2.csv");
const PROPERTIES_PATH = path.join(REFERENCE_DIR, "redirect_map_properties_final.csv");
const GSC_PATH = path.join(REFERENCE_DIR, "gsc_priority_urls.csv");

const MIGRATION_NGINX_OUTPUT_PATH = path.join(MIGRATION_DIR, "nginx-blancareal-redirects.conf");
const OPS_NGINX_OUTPUT_PATH = path.join(OPS_DIR, "blancareal-redirects.conf");
const DEPLOY_CHECKLIST_OUTPUT_PATH = path.join(MIGRATION_DIR, "DEPLOY_CHECKLIST.md");
const POST_DEPLOY_CHECKS_OUTPUT_PATH = path.join(MIGRATION_DIR, "post-deploy-url-checks.csv");

const APPROVED_STATUSES = new Set(["approved", "approved_section_fallback"]);

function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      field = "";
      if (!row.every((value) => value === "")) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (!row.every((value) => value === "")) {
      rows.push(row);
    }
  }

  return rows;
}

function readCsvRows(content) {
  const parsed = parseCsv(content);
  if (!parsed.length) return [];

  const [headers, ...body] = parsed;
  return body.map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? "";
    });
    return record;
  });
}

function csvEscape(value) {
  const normalized = value == null ? "" : String(value);
  return /[",\n\r]/.test(normalized)
    ? `"${normalized.replace(/"/g, '""')}"`
    : normalized;
}

function toCsv(headers, rows) {
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
}

function normalizePathname(pathname) {
  if (!pathname || pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

function toNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeRedirectRow(row, source) {
  return {
    old_url: String(row.old_url ?? "").trim(),
    target_url: String(row.target_url ?? "").trim(),
    redirect_type: String(row.redirect_type ?? "301").trim() || "301",
    status: String(row.status ?? "").trim(),
    notes: String(row.notes ?? "").trim(),
    source,
  };
}

function isDeployableRow(row) {
  return APPROVED_STATUSES.has(row.status) && row.target_url.length > 0;
}

function buildNginxConf(rows) {
  const uniqueRows = [];
  const seen = new Set();

  for (const row of rows) {
    const key = `${row.old_url}=>${row.target_url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRows.push(row);
  }

  uniqueRows.sort((left, right) => left.old_url.localeCompare(right.old_url));

  const mappedEntries = [];
  for (const row of uniqueRows) {
    const parsedOld = new URL(row.old_url);
    const oldPath = normalizePathname(parsedOld.pathname);

    mappedEntries.push({
      host: "www.blancareal.com",
      path: oldPath,
      target: row.target_url,
    });

    if (oldPath !== "/") {
      mappedEntries.push({
        host: "blancareal.com",
        path: oldPath,
        target: row.target_url,
      });
    }
  }

  const lines = [
    "# BlancaReal legacy redirects for SEO migration",
    "#",
    "# Include this file inside nginx `http {}` and call the generated map from the",
    "# relevant `server {}` blocks that must honor the legacy exact-path redirects.",
    "#",
    "# Important:",
    "# - DO NOT override `/` on canonical `blancareal.com`; keep Astro in control of `/ -> /es/`.",
    "# - Keep the approved legacy homepage redirect on `www.blancareal.com/ -> https://blancareal.com/en/`.",
    "# - Apply exact legacy redirects for `www.blancareal.com` and mirror them onto `blancareal.com` only",
    "#   for non-root paths, so they do not collide with the live canonical root route.",
    "#",
    "# Usage inside a matching server block:",
    "#",
    "#   if ($blancareal_legacy_redirect_target != \"\") {",
    "#     return 301 $blancareal_legacy_redirect_target;",
    "#   }",
    "",
    "map $host$uri $blancareal_legacy_redirect_target {",
    "    default \"\";",
  ];

  for (const entry of mappedEntries) {
    lines.push(`    "${entry.host}${entry.path}" ${entry.target};`);
  }

  lines.push("}");
  lines.push("");

  return lines.join("\n");
}

function buildDeployChecklistMarkdown() {
  return [
    "# Deploy checklist",
    "",
    "## Build",
    "",
    "- Production build command: `npm run build:production:web`",
    "- Expected output directory: `dist/web`",
    "- Do not use `npm run build` for this migration rollout.",
    "",
    "## Validate build surface before upload",
    "",
    "1. Run `npm run build:production:web` from the repo root.",
    "2. Confirm `dist/web` exists and contains the built public web output.",
    "3. Review `migration/redirect-target-validation.csv` and confirm every deployed target shows `route_exists_in_build = yes`.",
    "4. Spot-check the highest-risk validated target: `/es/sell-with-us/` must exist in the public web build.",
    "",
    "## Nginx reload",
    "",
    "1. Copy `migration/nginx-blancareal-redirects.conf` to the server include path.",
    "2. Run `sudo nginx -t`.",
    "3. Reload with `sudo systemctl reload nginx` or `sudo service nginx reload`.",
    "",
    "## Verify 301 and 200 after deploy",
    "",
    "1. Run `curl -I https://www.blancareal.com/blog/` and confirm `301` with the expected `Location`.",
    "2. Run `curl -I -L https://www.blancareal.com/blog/` and confirm the final response is `200`.",
    "3. Repeat the same check for the priority sample in `migration/post-deploy-url-checks.csv`.",
    "4. If any legacy URL produces an extra hop or ends in `404`, stop rollout and compare against `migration/redirect-target-validation.csv` and `migration/manual-review-hold.csv`.",
  ].join("\n");
}

function buildGscMap(gscRows) {
  const map = new Map();

  for (const row of gscRows) {
    const oldUrl = String(row.old_url ?? "").trim();
    if (!oldUrl) continue;
    map.set(oldUrl, {
      clicks: toNumber(row.clicks),
      impressions: toNumber(row.impressions),
      migration_priority: String(row.migration_priority ?? "").trim().toLowerCase(),
    });
  }

  return map;
}

function selectTopRows(rows, gscMap, limit) {
  return [...rows]
    .sort((left, right) => {
      const leftGsc = gscMap.get(left.old_url);
      const rightGsc = gscMap.get(right.old_url);

      const leftHasGsc = leftGsc ? 1 : 0;
      const rightHasGsc = rightGsc ? 1 : 0;
      if (rightHasGsc !== leftHasGsc) return rightHasGsc - leftHasGsc;

      const clicksDelta = (rightGsc?.clicks ?? 0) - (leftGsc?.clicks ?? 0);
      if (clicksDelta !== 0) return clicksDelta;

      const impressionsDelta = (rightGsc?.impressions ?? 0) - (leftGsc?.impressions ?? 0);
      if (impressionsDelta !== 0) return impressionsDelta;

      return left.old_url.localeCompare(right.old_url);
    })
    .slice(0, limit);
}

function buildPostDeployChecks(coreRows, propertyRows, gscMap) {
  const selectedCore = selectTopRows(coreRows, gscMap, 10).map((row) => ({
    old_url: row.old_url,
    expected_target: row.target_url,
    expected_status: "301",
    priority: gscMap.get(row.old_url)?.migration_priority || "high",
  }));

  const selectedProperties = selectTopRows(propertyRows, gscMap, 10).map((row) => ({
    old_url: row.old_url,
    expected_target: row.target_url,
    expected_status: "301",
    priority: gscMap.get(row.old_url)?.migration_priority || "high",
  }));

  return [...selectedCore, ...selectedProperties];
}

async function main() {
  const [coreRaw, propertiesRaw, gscRaw] = await Promise.all([
    fs.readFile(CORE_PATH, "utf8"),
    fs.readFile(PROPERTIES_PATH, "utf8"),
    fs.readFile(GSC_PATH, "utf8").catch(() => ""),
  ]);

  const coreRows = readCsvRows(coreRaw).map((row) => normalizeRedirectRow(row, "core"));
  const propertyRows = readCsvRows(propertiesRaw).map((row) => normalizeRedirectRow(row, "properties"));
  const gscRows = gscRaw ? readCsvRows(gscRaw) : [];
  const gscMap = buildGscMap(gscRows);

  const deployableCoreRows = coreRows.filter(isDeployableRow);
  const deployablePropertyRows = propertyRows.filter(isDeployableRow);
  const deployableRows = [...deployableCoreRows, ...deployablePropertyRows];

  const nginxConf = buildNginxConf(deployableRows);
  const deployChecklist = buildDeployChecklistMarkdown();
  const postDeployChecksCsv = toCsv(
    ["old_url", "expected_target", "expected_status", "priority"],
    buildPostDeployChecks(deployableCoreRows, deployablePropertyRows, gscMap)
  );

  await Promise.all([
    fs.mkdir(MIGRATION_DIR, { recursive: true }),
    fs.mkdir(OPS_DIR, { recursive: true }),
  ]);

  await Promise.all([
    fs.writeFile(MIGRATION_NGINX_OUTPUT_PATH, nginxConf, "utf8"),
    fs.writeFile(OPS_NGINX_OUTPUT_PATH, nginxConf, "utf8"),
    fs.writeFile(DEPLOY_CHECKLIST_OUTPUT_PATH, deployChecklist, "utf8"),
    fs.writeFile(POST_DEPLOY_CHECKS_OUTPUT_PATH, postDeployChecksCsv, "utf8"),
  ]);

  console.log(
    JSON.stringify(
      {
        deployableRows: deployableRows.length,
        coreChecks: Math.min(deployableCoreRows.length, 10),
        propertyChecks: Math.min(deployablePropertyRows.length, 10),
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
