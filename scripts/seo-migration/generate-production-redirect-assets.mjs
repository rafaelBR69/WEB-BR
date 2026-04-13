import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REFERENCE_DIR = path.join(__dirname, "reference");
const CORE_PATH = path.join(REFERENCE_DIR, "redirect_map_core_final_v2.csv");
const PROPERTIES_PATH = path.join(REFERENCE_DIR, "redirect_map_properties_final.csv");

const OPS_DIR = path.join(REPO_ROOT, "ops", "nginx");
const MIGRATION_DIR = path.join(REPO_ROOT, "migration");
const NGINX_OUTPUT_PATH = path.join(OPS_DIR, "blancareal-redirects.conf");
const MANUAL_REVIEW_OUTPUT_PATH = path.join(MIGRATION_DIR, "manual-review-hold.csv");
const MISSING_TARGETS_OUTPUT_PATH = path.join(MIGRATION_DIR, "missing-target-routes.md");
const I18N_REVIEW_OUTPUT_PATH = path.join(MIGRATION_DIR, "i18n-review.md");
const DEPLOY_GUIDE_OUTPUT_PATH = path.join(MIGRATION_DIR, "DEPLOY_REDIRECTS.md");
const POST_LAUNCH_OUTPUT_PATH = path.join(MIGRATION_DIR, "post-launch-checklist.md");

const WEB_PAGES_DIR = path.join(REPO_ROOT, "apps", "web", "src", "pages");
const ROOT_PAGES_DIR = path.join(REPO_ROOT, "src", "pages");
const POSTS_DIR = path.join(REPO_ROOT, "src", "data", "posts");
const PROPERTIES_DIR = path.join(REPO_ROOT, "src", "data", "properties");

const SUPPORTED_LANGS = ["es", "en", "de", "fr", "it", "nl"];
const APPROVED_STATUSES = new Set(["approved", "approved_section_fallback"]);

const CSV_NEWLINE = "\n";

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

      const isEmptyRow = row.every((value) => value === "");
      if (!isEmptyRow) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    const isEmptyRow = row.every((value) => value === "");
    if (!isEmptyRow) {
      rows.push(row);
    }
  }

  return rows;
}

function readCsvRows(content) {
  const parsed = parseCsv(content);
  if (!parsed.length) return [];

  const [headerRow, ...dataRows] = parsed;
  return dataRows.map((row) => {
    const record = {};
    headerRow.forEach((header, index) => {
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
  ].join(CSV_NEWLINE);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFilesFromDir(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => path.join(dirPath, entry.name));

  const rows = await Promise.all(
    files.map(async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8")))
  );

  return rows;
}

function normalizeRow(row, source) {
  const oldUrl = String(row.old_url ?? "").trim();
  const targetUrl = String(row.target_url ?? "").trim();
  const status = String(row.status ?? "").trim();
  const redirectType = String(row.redirect_type ?? "301").trim() || "301";
  const notes = String(row.notes ?? "").trim();
  return {
    source,
    old_url: oldUrl,
    target_url: targetUrl,
    status,
    redirect_type: redirectType,
    notes,
  };
}

function normalizePathname(pathname) {
  if (!pathname || pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

async function buildValidTargetPaths() {
  const validPaths = new Set();

  for (const lang of SUPPORTED_LANGS) {
    validPaths.add(`/${lang}/`);
  }

  const sectionRoutes = [
    { segment: "about", routeFile: path.join(WEB_PAGES_DIR, "[lang]", "about", "index.astro") },
    { segment: "contact", routeFile: path.join(WEB_PAGES_DIR, "[lang]", "contact", "index.astro") },
    { segment: "posts", routeFile: path.join(WEB_PAGES_DIR, "[lang]", "posts", "index.astro") },
    { segment: "projects", routeFile: path.join(WEB_PAGES_DIR, "[lang]", "projects", "index.astro") },
    { segment: "properties", routeFile: path.join(WEB_PAGES_DIR, "[lang]", "properties", "index.astro") },
    {
      segment: "commercialization",
      routeFile: path.join(WEB_PAGES_DIR, "[lang]", "commercialization", "index.astro"),
    },
    {
      segment: "legal-services",
      routeFile: path.join(WEB_PAGES_DIR, "[lang]", "legal-services", "index.astro"),
    },
    { segment: "sell-with-us", routeFile: path.join(WEB_PAGES_DIR, "[lang]", "sell-with-us", "index.astro") },
    { segment: "agents", routeFile: path.join(WEB_PAGES_DIR, "[lang]", "agents", "index.astro") },
  ];

  for (const route of sectionRoutes) {
    if (!(await fileExists(route.routeFile))) continue;
    for (const lang of SUPPORTED_LANGS) {
      validPaths.add(`/${lang}/${route.segment}/`);
    }
  }

  const posts = await readJsonFilesFromDir(POSTS_DIR);
  for (const post of posts) {
    const slugs = post?.slugs ?? {};
    for (const lang of SUPPORTED_LANGS) {
      const slug = typeof slugs[lang] === "string" ? slugs[lang].trim() : "";
      if (slug) {
        validPaths.add(`/${lang}/post/${slug}/`);
      }
    }
  }

  const properties = await readJsonFilesFromDir(PROPERTIES_DIR);
  for (const property of properties) {
    const slugs = property?.slugs ?? {};
    for (const lang of SUPPORTED_LANGS) {
      const slug = typeof slugs[lang] === "string" ? slugs[lang].trim() : "";
      if (slug) {
        validPaths.add(`/${lang}/property/${slug}/`);
      }
    }
  }

  return validPaths;
}

function isApprovedRow(row) {
  return APPROVED_STATUSES.has(row.status) && row.target_url.length > 0;
}

function validateTargetUrl(targetUrl, validTargetPaths) {
  if (!targetUrl) {
    return {
      ok: false,
      reason: "empty target_url",
    };
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return {
      ok: false,
      reason: "invalid absolute target_url",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: `unsupported target protocol ${parsed.protocol}`,
    };
  }

  if (parsed.host !== "blancareal.com") {
    return {
      ok: false,
      reason: `unsupported target host ${parsed.host}`,
    };
  }

  const pathname = normalizePathname(parsed.pathname);
  if (!validTargetPaths.has(pathname)) {
    return {
      ok: false,
      reason: `target path does not resolve in apps/web: ${pathname}`,
    };
  }

  return {
    ok: true,
    pathname,
  };
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
      source: row.source,
      status: row.status,
      notes: row.notes,
    });

    if (oldPath !== "/") {
      mappedEntries.push({
        host: "blancareal.com",
        path: oldPath,
        target: row.target_url,
        source: row.source,
        status: row.status,
        notes: row.notes,
      });
    }
  }

  const lines = [
    "# BlancaReal SEO migration redirects",
    "#",
    "# Include this file inside the nginx `http {}` context.",
    "# Then add the following inside the legacy/new-domain server blocks that must honor these exact-path redirects:",
    "#",
    "#   if ($blancareal_legacy_redirect_target != \"\") {",
    "#     return 301 $blancareal_legacy_redirect_target;",
    "#   }",
    "#",
    "# Hosts covered by this map:",
    "# - www.blancareal.com: all approved redirects, including the legacy root /",
    "# - blancareal.com: same exact-path redirects except /, which stays with Astro's current / -> /es/ behavior",
    "#",
    "map $host$uri $blancareal_legacy_redirect_target {",
    "    default \"\";",
  ];

  for (const entry of mappedEntries) {
    lines.push(
      `    "${entry.host}${entry.path}" ${entry.target};`
    );
  }

  lines.push("}");
  lines.push("");

  return lines.join(CSV_NEWLINE);
}

function buildManualReviewRows(coreRows, propertyRows) {
  const manualRows = [];

  for (const row of propertyRows) {
    if (row.status !== "manual_review_hold") continue;
    manualRows.push({
      source: "properties",
      old_url: row.old_url,
      target_url: row.target_url,
      status: row.status,
      reason: "manual_review_hold in source-of-truth; do not deploy yet",
      notes: row.notes,
    });
  }

  for (const row of coreRows) {
    if (row.target_url && APPROVED_STATUSES.has(row.status)) continue;
    manualRows.push({
      source: "core",
      old_url: row.old_url,
      target_url: row.target_url,
      status: row.status,
      reason: row.target_url
        ? "core row is not approved for deployment"
        : "core row has empty target_url",
      notes: row.notes,
    });
  }

  manualRows.sort((left, right) => left.old_url.localeCompare(right.old_url));
  return manualRows;
}

function buildMissingTargetsMarkdown({ approvedRows, deployableRows, missingRows }) {
  const lines = [
    "# Missing target routes",
    "",
    `Validated ${approvedRows.length} approved redirect rows from \`redirect_map_core_final_v2.csv\` and \`redirect_map_properties_final.csv\` against the Astro web surface in \`apps/web/src/pages\` and the content slug sources in \`src/data/posts/*.json\` and \`src/data/properties/*.json\`.`,
    "",
  ];

  if (!missingRows.length) {
    lines.push("No missing target routes were detected for the approved redirect set.");
    lines.push("");
    lines.push(`Deployable redirects after route validation: ${deployableRows.length}.`);
    return lines.join(CSV_NEWLINE);
  }

  lines.push(`Deployable redirects after route validation: ${deployableRows.length}.`);
  lines.push("");
  lines.push("## Missing or invalid targets");
  lines.push("");

  for (const row of missingRows) {
    lines.push(
      `- ${row.old_url} -> ${row.target_url || "(empty)"} | ${row.source} | ${row.status} | ${row.reason}`
    );
  }

  return lines.join(CSV_NEWLINE);
}

function buildI18nReviewMarkdown({ missingTargets }) {
  const lines = [
    "# Astro i18n review",
    "",
    "## Scope reviewed",
    "",
    "- `astro.config.mjs`",
    "- `apps/web/astro.config.mjs`",
    "- `config/create-astro-config.mjs`",
    "- `packages/shared/src/i18n/languages.ts`",
    "- `apps/web/src/pages/index.astro`",
    "- representative `[lang]/*` route files under `apps/web/src/pages`",
    "",
    "## Findings",
    "",
    "- Astro i18n config is not enabled in the reviewed config files. There is no `i18n` block, so `prefixDefaultLocale` and `redirectToDefaultLocale` are not configured.",
    "- Supported locales are handled manually through the `[lang]` route tree and `DEFAULT_LANG = \"es\"` in `packages/shared/src/i18n/languages.ts`.",
    "- The web surface root route in `apps/web/src/pages/index.astro` issues a `302` redirect from `/` to `/${DEFAULT_LANG}/`, which currently means `/es/`.",
    "- Individual `[lang]` routes guard invalid language params and redirect to the default-language section, usually with `302` responses. That behavior does not conflict with the approved Nginx redirects because the redirect targets already point to final language-prefixed URLs.",
    "- Astro v6's `redirectToDefaultLocale` restriction is not a blocker here because the feature is not being used at all.",
    "",
    "## Safe deployment implications",
    "",
    "- The generated Nginx map keeps the legacy root redirect only on `www.blancareal.com`. It intentionally omits `/` for bare `blancareal.com` so production does not override Astro's current `/ -> /es/` behavior on the canonical host.",
    "- All other approved legacy exact-path redirects are mirrored onto bare `blancareal.com`, because those old paths are outside the live language-prefixed route space and do not collide with current Astro pages.",
    "- No redirect loop was detected in the approved set: Nginx points directly to final `https://blancareal.com/{lang}/...` URLs, and Astro does not add another locale redirect on those resolved targets.",
    "",
    "## Build-surface risk",
    "",
    "- The web deployment must use the web surface config (`apps/web/astro.config.mjs`) through `npm run build:production:web`.",
    "- The repo-level default build command still points to `astro build` with the root config. That surface does not include every route used by the approved redirect map, notably `apps/web/src/pages/[lang]/sell-with-us/index.astro` has no equivalent under `src/pages`.",
    "- I did not change the build command automatically because that is a deployment/workflow decision, not a clearly safe code-only fix.",
  ];

  if (missingTargets.length) {
    lines.push("");
    lines.push("## Route validation warning");
    lines.push("");
    lines.push(
      `- ${missingTargets.length} approved redirect target(s) do not currently resolve in the web surface. See \`migration/missing-target-routes.md\` before deployment.`
    );
  } else {
    lines.push("");
    lines.push("## Route validation result");
    lines.push("");
    lines.push("- All approved redirect targets resolve in the web surface that was reviewed.");
  }

  return lines.join(CSV_NEWLINE);
}

function buildDeployGuideMarkdown({ deployableCount }) {
  return [
    "# Deploy redirects on IONOS Nginx",
    "",
    "## Files",
    "",
    "- Redirect map snippet ready for deploy/include: `migration/nginx-blancareal-redirects.conf`",
    "- Repo mirror of the same generated snippet: `ops/nginx/blancareal-redirects.conf`",
    "- Manual exceptions: `migration/manual-review-hold.csv`",
    "- Route validation report: `migration/missing-target-routes.md`",
    "- i18n review: `migration/i18n-review.md`",
    "",
    "## Placement",
    "",
    "1. Copy `migration/nginx-blancareal-redirects.conf` to the server, for example:",
    "   - `/etc/nginx/snippets/blancareal-redirects.conf`",
    "2. Include the file inside the global `http {}` context, not directly inside a `location {}` block.",
    "3. In each relevant `server {}` block that serves legacy traffic, add:",
    "",
    "```nginx",
    "if ($blancareal_legacy_redirect_target != \"\") {",
    "    return 301 $blancareal_legacy_redirect_target;",
    "}",
    "```",
    "",
    "4. Apply that `if` to:",
    "   - the `www.blancareal.com` server block",
    "   - the `blancareal.com` server block that serves the public web surface",
    "5. Keep the generated root exception as-is: the bare-host `/` redirect is intentionally not in the map.",
    "",
    "## Validate configuration",
    "",
    "```bash",
    "sudo nginx -t",
    "```",
    "",
    "If the config test passes, reload Nginx:",
    "",
    "```bash",
    "sudo systemctl reload nginx",
    "```",
    "",
    "If the server uses the legacy service command set:",
    "",
    "```bash",
    "sudo service nginx reload",
    "```",
    "",
    "## Verify 301 responses",
    "",
    "Use `curl -I` against high-priority old URLs and confirm:",
    "- status is `301`",
    "- `Location` points directly to the final `https://blancareal.com/{lang}/...` URL",
    "- there is no intermediate hop",
    "",
    "Examples:",
    "",
    "```bash",
    "curl -I https://www.blancareal.com/blog/",
    "curl -I https://www.blancareal.com/contact/",
    "curl -I https://www.blancareal.com/property/amazing-duplex-penthouse-fuengirola/",
    "curl -I https://www.blancareal.com/how-can-i-legally-rent-my-property-to-tourists-in-andalusia/",
    "```",
    "",
    "## Check for chains and destination 404s",
    "",
    "1. Test a priority sample from `scripts/seo-migration/reference/gsc_priority_urls.csv`.",
    "2. Follow each redirect once with `curl -I -L` and confirm the final response is `200`.",
    "3. Spot-check all section fallbacks (`/posts/`, `/projects/`, `/properties/`, `/contact/`).",
    "4. If any response lands on a `404` or another `301`, stop rollout and compare it with `migration/missing-target-routes.md`.",
    "",
    `## Current deployable redirect count`,
    "",
    `- ${deployableCount} approved redirects resolved to existing routes and were included in the generated Nginx map.`,
  ].join(CSV_NEWLINE);
}

function buildPostLaunchChecklistMarkdown() {
  return [
    "# Post-launch validation checklist",
    "",
    "- Test the highest-priority legacy URLs from `scripts/seo-migration/reference/gsc_priority_urls.csv`, starting with homepage, blog, contact, projects, and the top property URLs.",
    "- Confirm every tested legacy URL returns a single `301` to the expected final destination.",
    "- Confirm priority destinations return `200` after the redirect and do not bounce through an extra locale redirect.",
    "- Re-check all `approved_section_fallback` URLs, because they carry the highest intent mismatch risk even when technically valid.",
    "- Monitor Google Search Console coverage and indexing changes after launch.",
    "- Review GSC pages with clicks/impressions and confirm that priority legacy URLs no longer show redirect or soft-404 problems.",
    "- Review server logs for `404` responses on legacy paths and compare them with `migration/manual-review-hold.csv`.",
    "- Review server logs for repeated hits to old paths that are still missing from the approved map.",
    "- Verify canonical tags on redirected destination pages, especially posts, properties, projects, and contact/about pages.",
    "- Verify `hreflang` / language alternates if they are emitted on the destination pages.",
    "- Re-crawl a sample of old URLs with your preferred crawler to confirm there are no redirect chains.",
    "- Keep the manual-review set out of production until business/SEO signs off the unresolved property mappings.",
  ].join(CSV_NEWLINE);
}

async function main() {
  const [coreRaw, propertiesRaw] = await Promise.all([
    fs.readFile(CORE_PATH, "utf8"),
    fs.readFile(PROPERTIES_PATH, "utf8"),
  ]);

  const coreRows = readCsvRows(coreRaw).map((row) => normalizeRow(row, "core"));
  const propertyRows = readCsvRows(propertiesRaw).map((row) => normalizeRow(row, "properties"));

  const validTargetPaths = await buildValidTargetPaths();

  const approvedRows = [...coreRows, ...propertyRows].filter(isApprovedRow);
  const deployableRows = [];
  const missingTargetRows = [];

  for (const row of approvedRows) {
    const validation = validateTargetUrl(row.target_url, validTargetPaths);
    if (!validation.ok) {
      missingTargetRows.push({
        ...row,
        reason: validation.reason,
      });
      continue;
    }
    deployableRows.push(row);
  }

  const manualReviewRows = buildManualReviewRows(coreRows, propertyRows);
  const nginxConf = buildNginxConf(deployableRows);
  const manualReviewCsv = toCsv(
    ["source", "old_url", "target_url", "status", "reason", "notes"],
    manualReviewRows
  );
  const missingTargetsMd = buildMissingTargetsMarkdown({
    approvedRows,
    deployableRows,
    missingRows: missingTargetRows,
  });
  const i18nReviewMd = buildI18nReviewMarkdown({ missingTargets: missingTargetRows });
  const deployGuideMd = buildDeployGuideMarkdown({ deployableCount: deployableRows.length });
  const postLaunchMd = buildPostLaunchChecklistMarkdown();

  await Promise.all([
    fs.mkdir(OPS_DIR, { recursive: true }),
    fs.mkdir(MIGRATION_DIR, { recursive: true }),
  ]);

  await Promise.all([
    fs.writeFile(NGINX_OUTPUT_PATH, nginxConf, "utf8"),
    fs.writeFile(MANUAL_REVIEW_OUTPUT_PATH, manualReviewCsv, "utf8"),
    fs.writeFile(MISSING_TARGETS_OUTPUT_PATH, missingTargetsMd, "utf8"),
    fs.writeFile(I18N_REVIEW_OUTPUT_PATH, i18nReviewMd, "utf8"),
    fs.writeFile(DEPLOY_GUIDE_OUTPUT_PATH, deployGuideMd, "utf8"),
    fs.writeFile(POST_LAUNCH_OUTPUT_PATH, postLaunchMd, "utf8"),
  ]);

  console.log(
    JSON.stringify(
      {
        approvedRows: approvedRows.length,
        deployableRows: deployableRows.length,
        manualReviewRows: manualReviewRows.length,
        missingTargetRows: missingTargetRows.length,
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
