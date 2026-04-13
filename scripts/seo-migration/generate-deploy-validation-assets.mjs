import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REFERENCE_DIR = path.join(__dirname, "reference");
const MIGRATION_DIR = path.join(REPO_ROOT, "migration");

const CORE_PATH = path.join(REFERENCE_DIR, "redirect_map_core_final_v2.csv");
const PROPERTIES_PATH = path.join(REFERENCE_DIR, "redirect_map_properties_final.csv");
const ROOT_PACKAGE_PATH = path.join(REPO_ROOT, "package.json");
const WEB_PACKAGE_PATH = path.join(REPO_ROOT, "apps", "web", "package.json");
const README_PATH = path.join(REPO_ROOT, "README.md");
const PRODUCCION_PATH = path.join(REPO_ROOT, "produccion.txt");
const NGINX_CONF_PATH = path.join(REPO_ROOT, "ops", "nginx", "blancareal-redirects.conf");

const BUILD_SURFACE_REVIEW_PATH = path.join(MIGRATION_DIR, "build-surface-review.md");
const TARGET_VALIDATION_PATH = path.join(MIGRATION_DIR, "redirect-target-validation.csv");
const DEPLOY_BUILD_FIX_PATH = path.join(MIGRATION_DIR, "deploy-build-fix.md");
const ROOT_LANGUAGE_DECISION_PATH = path.join(MIGRATION_DIR, "root-language-decision.md");

const WEB_PAGES_DIR = path.join(REPO_ROOT, "apps", "web", "src", "pages");
const ROOT_PAGES_DIR = path.join(REPO_ROOT, "src", "pages");
const POSTS_DIR = path.join(REPO_ROOT, "src", "data", "posts");
const PROPERTIES_DIR = path.join(REPO_ROOT, "src", "data", "properties");
const APPROVED_STATUSES = new Set(["approved", "approved_section_fallback"]);
const SUPPORTED_LANGS = ["es", "en", "de", "fr", "it", "nl"];

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
      if (!row.every((value) => value === "")) rows.push(row);
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (!row.every((value) => value === "")) rows.push(row);
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

  return Promise.all(files.map((filePath) => fs.readFile(filePath, "utf8").then(JSON.parse)));
}

function normalizePathname(pathname) {
  if (!pathname || pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

async function buildValidTargetPathsForSurface(pagesDir) {
  const validPaths = new Set();

  const langIndexFile = path.join(pagesDir, "[lang]", "index.astro");
  if (await fileExists(langIndexFile)) {
    for (const lang of SUPPORTED_LANGS) {
      validPaths.add(`/${lang}/`);
    }
  }

  const sections = [
    "about",
    "contact",
    "posts",
    "projects",
    "properties",
    "commercialization",
    "legal-services",
    "sell-with-us",
    "agents",
  ];

  for (const section of sections) {
    const routeFile = path.join(pagesDir, "[lang]", section, "index.astro");
    if (!(await fileExists(routeFile))) continue;
    for (const lang of SUPPORTED_LANGS) {
      validPaths.add(`/${lang}/${section}/`);
    }
  }

  if (await fileExists(path.join(pagesDir, "[lang]", "post", "[slug].astro"))) {
    const posts = await readJsonFilesFromDir(POSTS_DIR);
    for (const post of posts) {
      const slugs = post?.slugs ?? {};
      for (const lang of SUPPORTED_LANGS) {
        const slug = typeof slugs[lang] === "string" ? slugs[lang].trim() : "";
        if (slug) validPaths.add(`/${lang}/post/${slug}/`);
      }
    }
  }

  if (await fileExists(path.join(pagesDir, "[lang]", "property", "[slug].astro"))) {
    const properties = await readJsonFilesFromDir(PROPERTIES_DIR);
    for (const property of properties) {
      const slugs = property?.slugs ?? {};
      for (const lang of SUPPORTED_LANGS) {
        const slug = typeof slugs[lang] === "string" ? slugs[lang].trim() : "";
        if (slug) validPaths.add(`/${lang}/property/${slug}/`);
      }
    }
  }

  return validPaths;
}

function evaluateTarget(targetUrl, validPaths) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }
  if (parsed.host !== "blancareal.com" || parsed.protocol !== "https:") {
    return false;
  }
  return validPaths.has(normalizePathname(parsed.pathname));
}

function countLinesWith(content, needle) {
  return content.includes(needle);
}

function buildSurfaceReviewMarkdown({
  rootPackage,
  webPackage,
  readmeContent,
  produccionContent,
  rootBuildMissingTargets,
}) {
  const lines = [
    "# Build surface review",
    "",
    "## Files inspected",
    "",
    "- `package.json`",
    "- `apps/web/package.json`",
    "- `README.md`",
    "- `produccion.txt`",
    "- deployment-related repo paths (`.github/`, `deploy/`, `ci/`)",
    "",
    "## Script inventory",
    "",
    `- Root \`build\`: \`${rootPackage.scripts.build}\``,
    `- Root \`build:web\`: \`${rootPackage.scripts["build:web"]}\``,
    `- Root \`build:production:web\`: \`${rootPackage.scripts["build:production:web"]}\``,
    `- apps/web \`build\`: \`${webPackage.scripts.build}\``,
    "",
    "## Deployment evidence found in repo",
    "",
    "- No IONOS-specific deploy script, CI workflow, systemd unit, PM2 config, Docker deploy file, or shell deploy script was found in the repository.",
    `- \`produccion.txt\` is ${produccionContent.trim().length ? "not empty" : "empty"}, so it does not define the production build command.`,
    `- \`README.md\` documents public-web deployment with \`npm run build:production:web\`: ${countLinesWith(readmeContent, "para despliegue de web publica usa `npm run build:production:web`") ? "yes" : "no"}.`,
    "",
    "## Conclusion",
    "",
    "- The repository does not encode the live IONOS build command with certainty.",
    "- The repo now exposes an explicit public-web production command: `npm run build:production:web`.",
    "- That command resolves to the dedicated web surface under `apps/web`, not to the root Astro surface.",
    "- The root command `npm run build` remains in the repo for the legacy/root surface and should not be used for this SEO migration rollout.",
  ];

  if (rootBuildMissingTargets.length) {
    lines.push(
      `- The root surface is not sufficient for the approved redirect targets: ${rootBuildMissingTargets.length} target(s) used by redirects are missing there.`
    );
  } else {
    lines.push("- The root surface also resolves the approved targets.");
  }

  lines.push("");
  lines.push("## Recommended production build command");
  lines.push("");
  lines.push("- `npm run build:production:web`");
  lines.push("- This is currently an explicit alias to `npm run build:web`.");
  lines.push("- If the server launch step is managed externally, it should run against the generated `dist/web` output.");

  return lines.join("\n");
}

function buildDeployBuildFixMarkdown({ rootBuildMissingTargets }) {
  const lines = [
    "# Deploy build fix",
    "",
    "## Why a change is needed",
    "",
    "- The approved redirect map uses public-web targets that belong to the dedicated web surface under `apps/web/src/pages`.",
  ];

  if (rootBuildMissingTargets.length) {
    lines.push(
      `- I verified that ${rootBuildMissingTargets.length} approved redirect target(s) are missing from the root surface, so a deployment that still uses \`npm run build\` can produce 301 -> 404 for those paths.`
    );
  } else {
    lines.push("- I did not detect missing approved targets in the root surface.");
  }

  lines.push("");
  lines.push("## Safe repo change prepared");
  lines.push("");
  lines.push("- Added `build:production:web` to the root `package.json` as an explicit alias to `npm run build:web`.");
  lines.push("- Updated public-web deployment documentation to point to `npm run build:production:web` and `dist/web`.");
  lines.push("");
  lines.push("## External deployment change to apply");
  lines.push("");
  lines.push("1. Ensure the external production build command is `npm run build:production:web`, not `npm run build`.");
  lines.push("2. Ensure the runtime/start step serves the `dist/web` output, not the root `dist` output.");
  lines.push("3. Keep CRM deployment separate; do not repoint any CRM process to the web surface.");
  lines.push("");
  lines.push("## No destructive repo changes applied");
  lines.push("");
  lines.push("- I did not replace the existing root `build` script because that could affect other environments still relying on it.");

  return lines.join("\n");
}

function buildRootLanguageDecisionMarkdown() {
  return [
    "# Root language decision",
    "",
    "## Current behavior",
    "",
    "- `apps/web/src/pages/index.astro` redirects `/` to `/es/` with `302`.",
    "- The approved legacy redirect map sends `https://www.blancareal.com/` to `https://blancareal.com/en/`.",
    "- The generated Nginx include intentionally leaves bare-host `https://blancareal.com/` under Astro control, so canonical root stays `/ -> /es/`.",
    "",
    "## Impact",
    "",
    "- Legacy English traffic hitting `www.blancareal.com/` lands on `/en/`, which preserves the approved migration intent for the old homepage.",
    "- Direct visits to the canonical root `blancareal.com/` still land on `/es/`, which matches the current default language configured in code.",
    "- This creates a split behavior at root level, but it is deterministic and avoids changing the site-wide default language without business approval.",
    "",
    "## Recommendation",
    "",
    "- Keep the current canonical root behavior: `/ -> /es/`.",
    "- Keep the legacy homepage redirect on `www.blancareal.com/ -> /en/` because it is already approved in the migration source of truth.",
    "- Revisit the default-language decision only if product/SEO explicitly wants the canonical host root to become English. That change should be handled as a separate language strategy task, not bundled into redirect deployment.",
  ].join("\n");
}

function buildValidationRows(targetUrls, webValidPaths, rootValidPaths) {
  return targetUrls.map((targetUrl) => {
    const existsInWebBuild = evaluateTarget(targetUrl, webValidPaths);
    const existsInRootBuild = evaluateTarget(targetUrl, rootValidPaths);

    let riskLevel = "low";
    let notes = "Validated in the dedicated web surface build (`npm run build:production:web` -> `dist/web`).";

    if (!existsInWebBuild) {
      riskLevel = "high";
      notes = "Missing from the dedicated web surface; do not deploy redirects to this target.";
    } else if (!existsInRootBuild) {
      riskLevel = "medium";
      notes =
        "Exists in the web surface build but not in the root surface. If production still uses `npm run build`, this target is at risk.";
    }

    return {
      target_url: targetUrl,
      route_exists_in_build: existsInWebBuild ? "yes" : "no",
      source_surface: "apps/web -> dist/web",
      risk_level: riskLevel,
      notes,
    };
  });
}

async function main() {
  const [coreRaw, propertiesRaw, rootPackageRaw, webPackageRaw, readmeContent, produccionContent] =
    await Promise.all([
      fs.readFile(CORE_PATH, "utf8"),
      fs.readFile(PROPERTIES_PATH, "utf8"),
      fs.readFile(ROOT_PACKAGE_PATH, "utf8"),
      fs.readFile(WEB_PACKAGE_PATH, "utf8"),
      fs.readFile(README_PATH, "utf8"),
      fs.readFile(PRODUCCION_PATH, "utf8").catch(() => ""),
    ]);

  const coreRows = readCsvRows(coreRaw);
  const propertyRows = readCsvRows(propertiesRaw);
  const rootPackage = JSON.parse(rootPackageRaw);
  const webPackage = JSON.parse(webPackageRaw);

  const targetUrls = Array.from(
    new Set(
      [...coreRows, ...propertyRows]
        .filter((row) => APPROVED_STATUSES.has(String(row.status ?? "").trim()))
        .map((row) => String(row.target_url ?? "").trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));

  const [webValidPaths, rootValidPaths] = await Promise.all([
    buildValidTargetPathsForSurface(WEB_PAGES_DIR),
    buildValidTargetPathsForSurface(ROOT_PAGES_DIR),
  ]);

  const validationRows = buildValidationRows(targetUrls, webValidPaths, rootValidPaths);
  const rootBuildMissingTargets = validationRows.filter((row) => row.risk_level === "medium");

  const buildSurfaceReview = buildSurfaceReviewMarkdown({
    rootPackage,
    webPackage,
    readmeContent,
    produccionContent,
    rootBuildMissingTargets,
  });
  const deployBuildFix = buildDeployBuildFixMarkdown({ rootBuildMissingTargets });
  const rootLanguageDecision = buildRootLanguageDecisionMarkdown();
  const validationCsv = toCsv(
    ["target_url", "route_exists_in_build", "source_surface", "risk_level", "notes"],
    validationRows
  );

  await fs.mkdir(MIGRATION_DIR, { recursive: true });
  await Promise.all([
    fs.writeFile(BUILD_SURFACE_REVIEW_PATH, buildSurfaceReview, "utf8"),
    fs.writeFile(TARGET_VALIDATION_PATH, validationCsv, "utf8"),
    fs.writeFile(DEPLOY_BUILD_FIX_PATH, deployBuildFix, "utf8"),
    fs.writeFile(ROOT_LANGUAGE_DECISION_PATH, rootLanguageDecision, "utf8"),
  ]);

  if (await fileExists(NGINX_CONF_PATH)) {
    const existing = await fs.readFile(NGINX_CONF_PATH, "utf8");
    const updated = existing.replace(
      "# Hosts covered by this map:\n# - www.blancareal.com: all approved redirects, including the legacy root /\n# - blancareal.com: same exact-path redirects except /, which stays with Astro's current / -> /es/ behavior",
      "# Hosts covered by this map:\n# - www.blancareal.com: all approved redirects, including the approved legacy root redirect / -> https://blancareal.com/en/\n# - blancareal.com: same exact-path redirects except /, which stays under Astro and currently resolves / -> /es/\n# - This split is intentional and documented in migration/root-language-decision.md"
    );
    await fs.writeFile(NGINX_CONF_PATH, updated, "utf8");
  }

  console.log(
    JSON.stringify(
      {
        uniqueTargets: targetUrls.length,
        webBuildValidated: validationRows.filter((row) => row.route_exists_in_build === "yes").length,
        webBuildMissing: validationRows.filter((row) => row.route_exists_in_build === "no").length,
        rootBuildRiskTargets: rootBuildMissingTargets.length,
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
