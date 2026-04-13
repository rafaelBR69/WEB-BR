import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const INPUT_PATH = path.join(__dirname, "input", "ahrefs-page-explorer-pages-2026-04-10.csv");
const MASTER_AUDIT_PATH = path.join(REPO_ROOT, "seo_url_audit_master.csv");
const OUTPUT_DIR = path.join(__dirname, "reference");
const SITE_URL = "https://blancareal.com";

const SUPPORTED_LANGS = ["es", "en", "de", "fr", "it", "nl"];

const PAGE_ALIAS_MAP = {
  "/": { buildTarget: (lang) => `/${lang}/`, note: "Legacy root home." },
  "/home/": { buildTarget: (lang) => `/${lang}/`, note: "Legacy home alias." },
  "/blog/": { buildTarget: (lang) => `/${lang}/posts/`, note: "Legacy blog index." },
  "/bloggen/": { buildTarget: (lang) => `/${lang}/posts/`, note: "Legacy Dutch blog index." },
  "/contact/": { buildTarget: (lang) => `/${lang}/contact/`, note: "Legacy contact page." },
  "/contact-blancareal-costadel-sol/": {
    buildTarget: (lang) => `/${lang}/contact/`,
    note: "Legacy contact alias.",
  },
  "/about-us/": { buildTarget: (lang) => `/${lang}/about/`, note: "Legacy about page." },
  "/about-us-2/": { buildTarget: (lang) => `/${lang}/about/`, note: "Legacy duplicate about page." },
  "/property-search/": {
    buildTarget: (lang) => `/${lang}/properties/`,
    note: "Legacy property search page.",
  },
  "/property/": {
    buildTarget: (lang) => `/${lang}/properties/`,
    note: "Legacy property archive root.",
  },
  "/our-developments/": {
    buildTarget: (lang) => `/${lang}/projects/`,
    note: "Legacy developments index.",
  },
  "/our-developments-2/": {
    buildTarget: (lang) => `/${lang}/projects/`,
    note: "Legacy duplicate developments index.",
  },
};

const PATH_SPECIFIC_ALIAS_MAP = {
  "/es/sell-your-property/": {
    newPath: "/es/sell-with-us/",
    note: "Legacy Spanish sell page.",
  },
  "/es/comercializacion-inmobiliaria-costa-del-sol/": {
    newPath: "/es/commercialization/",
    note: "Legacy Spanish commercialization page.",
  },
  "/nl/onze-promoties/": {
    newPath: "/nl/projects/",
    note: "Legacy Dutch developments page.",
  },
};

const POST_SLUG_ALIAS_MAP = {
  "how-can-i-legally-rent-my-property-to-tourists-in-andalusia": "rent-your-home-to-tourists-andalucia",
  "legal-information-on-illegal-occupation-in-spain": "legal-information-illegal-occupation-spain",
  "dorronsoro-architeture-firm-behind-calahonda-sunset": "dorronsoro-architects-behind-calahonda-sunset",
  "we-sell-your-home-professional-mediation-with-in-house-legal-services-and-marketing": "sell-your-home-blancareal",
};

const PROPERTY_SLUG_ALIAS_MAP = {
  "3-bedroom-apartment-beachfront-fuengirola": "3-bedroom-apartment-paseo-maritimo-fuengirola",
  "3-bedrooms-penthouse-las-lagunas-mijas": "3-bedroom-penthouse-las-lagunas-de-mijas",
  "amazing-duplex-penthouse-fuengirola": "4-bedroom-duplex-penthouse-fuengirola",
  "new-townhouses-san-pedro-de-alcantara": "townhouses-san-pedro-de-alcantara",
  "new-build-penthouse-los-pacos-fuengirola": "new-build-penthouse-fuengirola",
  "piso-1a-planta-avenida-carlos-haya-malaga": "1-bedroom-apartment-carlos-haya-malaga",
};

const LEGAL_PATHS = new Set(["/privacy-policy/", "/cookies-policy/", "/legal-notice/"]);

const SERVICE_PATHS = new Set([
  "/about-us/",
  "/about-us-2/",
  "/contact/",
  "/contact-blancareal-costadel-sol/",
  "/faqs/",
  "/services/",
  "/our-developments/",
  "/our-developments-2/",
  "/new-construction/",
  "/property-search/",
  "/second-hand/",
  "/second-hand-2/",
  "/rentals/",
  "/rentals-2/",
  "/vacation/",
  "/luxury-villas/",
  "/sell-your-property/",
  "/comercializacion-inmobiliaria-costa-del-sol/",
  "/onze-promoties/",
]);

const DUPLICATE_CANONICAL_MAP = {
  "/home/": "/",
  "/about-us-2/": "/about-us/",
  "/our-developments-2/": "/our-developments/",
  "/rentals-2/": "/rentals/",
  "/second-hand-2/": "/second-hand/",
  "/contact-blancareal-costadel-sol/": "/contact/",
};

const STARTER_HEADERS = [
  "old_url",
  "old_title",
  "old_status",
  "old_indexable",
  "old_inlinks",
  "old_type",
  "old_language",
  "keep_candidate",
  "reason",
  "new_url_candidate",
  "match_confidence",
  "notes",
];

const INVENTORY_HEADERS = [
  "URL",
  "Title",
  "HTTP status code",
  "Is indexable page",
  "No. of all inlinks",
  "Content type",
];

function stripBom(value) {
  return value.replace(/^\uFEFF/, "");
}

function parseDelimited(content, delimiter) {
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

    if (char === delimiter) {
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

function readRows(content, delimiter) {
  const parsed = parseDelimited(content, delimiter);
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

function normalizePath(pathname) {
  if (!pathname || pathname === "") return "/";
  let next = pathname;
  if (!next.startsWith("/")) next = `/${next}`;
  if (!next.endsWith("/")) next = `${next}/`;
  return next.replace(/\/+/g, "/");
}

function detectLangAndPath(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];

  if (first && SUPPORTED_LANGS.includes(first)) {
    return {
      lang: first,
      unprefixedPath: normalizePath(`/${segments.slice(1).join("/")}`),
    };
  }

  return {
    lang: "en",
    unprefixedPath: normalizePath(pathname),
  };
}

function lower(value) {
  return String(value ?? "").trim().toLowerCase();
}

function buildExactSlugMap(masterRows, urlType) {
  const map = new Map();

  for (const row of masterRows) {
    if (row.url_type !== urlType) continue;
    if (row.index_status !== "indexable") continue;
    if (!row.entity_slug || row.entity_slug === "__template__") continue;
    const key = `${row.lang}:${row.entity_slug}`;
    const existing = map.get(key) ?? [];
    existing.push(row);
    map.set(key, existing);
  }

  return map;
}

function hasSingleSlug(unprefixedPath) {
  const trimmed = unprefixedPath.replace(/^\/|\/$/g, "");
  return Boolean(trimmed) && !trimmed.includes("/");
}

function classifyOldType(row) {
  const oldUrl = new URL(row.URL);
  const normalizedPath = normalizePath(oldUrl.pathname);
  const { lang, unprefixedPath } = detectLangAndPath(normalizedPath);

  if (normalizedPath === "/" && oldUrl.searchParams.get("post_type") === "property") {
    return "property";
  }

  if (normalizedPath === "/" && oldUrl.searchParams.has("page_id")) {
    return "other";
  }

  if (normalizedPath === "/" || unprefixedPath === "/home/") {
    return "home";
  }

  if ((lang !== "en" && normalizedPath === `/${lang}/`) || normalizedPath === "/") {
    if (lang !== "en" && oldUrl.pathname !== "/") {
      return "language_variant";
    }
  }

  if (/^\/(blog|bloggen)\/page\/\d+\/$/.test(unprefixedPath)) {
    return "blog_pagination";
  }

  if (unprefixedPath === "/blog/" || unprefixedPath === "/bloggen/") {
    return "blog_index";
  }

  if (unprefixedPath.startsWith("/category/")) {
    return "category";
  }

  if (unprefixedPath.startsWith("/tag/")) {
    return "tag";
  }

  if (LEGAL_PATHS.has(unprefixedPath)) {
    return "legal";
  }

  if (unprefixedPath.startsWith("/property/")) {
    return "property";
  }

  if (SERVICE_PATHS.has(unprefixedPath)) {
    return "service_page";
  }

  if (lang !== "en" && normalizedPath === `/${lang}/`) {
    return "language_variant";
  }

  return "other";
}

function getDuplicateCanonical(unprefixedPath) {
  return DUPLICATE_CANONICAL_MAP[unprefixedPath] ?? "";
}

function buildDuplicateIndex(htmlRows) {
  const canonicalToDuplicates = new Map();

  for (const row of htmlRows) {
    const oldUrl = new URL(row.URL);
    const normalizedPath = normalizePath(oldUrl.pathname);
    const { unprefixedPath } = detectLangAndPath(normalizedPath);
    const canonical = getDuplicateCanonical(unprefixedPath);
    if (!canonical) continue;

    const existing = canonicalToDuplicates.get(canonical) ?? [];
    existing.push(row.URL);
    canonicalToDuplicates.set(canonical, existing);
  }

  return canonicalToDuplicates;
}

function buildNotes({ row, duplicateIndex, candidateNote, reasonNote }) {
  const notes = [];
  const oldUrl = new URL(row.URL);
  const normalizedPath = normalizePath(oldUrl.pathname);
  const { unprefixedPath } = detectLangAndPath(normalizedPath);
  const canonicalDuplicate = getDuplicateCanonical(unprefixedPath);

  if (canonicalDuplicate) {
    notes.push(`Obvious duplicate of ${canonicalDuplicate}.`);
  }

  const duplicates = duplicateIndex.get(unprefixedPath) ?? [];
  if (duplicates.length > 0) {
    notes.push(`Has obvious duplicate alias(es): ${duplicates.join(" | ")}.`);
  }

  if (candidateNote) {
    notes.push(candidateNote);
  }

  if (reasonNote) {
    notes.push(reasonNote);
  }

  return notes.join(" ");
}

function findExactSlugMatch(map, lang, slug) {
  const matches = map.get(`${lang}:${slug}`) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

function findObviousCandidate(row, masterRows, postSlugMap, propertySlugMap) {
  const oldUrl = new URL(row.URL);
  const normalizedPath = normalizePath(oldUrl.pathname);
  const { lang, unprefixedPath } = detectLangAndPath(normalizedPath);
  const status = String(row["HTTP status code"] ?? "");

  if (status === "301" || status === "404") {
    return { newUrl: "", confidence: "", note: "" };
  }

  const pathSpecific = PATH_SPECIFIC_ALIAS_MAP[normalizedPath];
  if (pathSpecific) {
    const matched = masterRows.find((entry) => entry.new_url === `${SITE_URL}${pathSpecific.newPath}`) ?? null;
    if (matched) {
      return {
        newUrl: matched.new_url,
        confidence: "high",
        note: pathSpecific.note,
      };
    }
  }

  const pageAlias = PAGE_ALIAS_MAP[unprefixedPath];
  if (pageAlias) {
    const targetUrl = `${SITE_URL}${pageAlias.buildTarget(lang)}`;
    const matched = masterRows.find((entry) => entry.new_url === targetUrl) ?? null;
    if (matched) {
      return {
        newUrl: matched.new_url,
        confidence: "high",
        note: pageAlias.note,
      };
    }
  }

  if (unprefixedPath.startsWith("/property/")) {
    const slug = unprefixedPath.replace(/^\/property\//, "").replace(/\/$/, "");
    const exact = findExactSlugMatch(propertySlugMap, lang, slug);
    if (exact) {
      return {
        newUrl: exact.new_url,
        confidence: "high",
        note: "Legacy property slug matches a current property slug exactly.",
      };
    }

    const aliasSlug = PROPERTY_SLUG_ALIAS_MAP[slug];
    if (aliasSlug) {
      const aliasMatch = findExactSlugMatch(propertySlugMap, lang, aliasSlug);
      if (aliasMatch) {
        return {
          newUrl: aliasMatch.new_url,
          confidence: "high",
          note: `Legacy property slug mapped through explicit alias (${aliasSlug}).`,
        };
      }
    }

    return { newUrl: "", confidence: "", note: "" };
  }

  const trimmedSlug = unprefixedPath.replace(/^\/|\/$/g, "");
  if (hasSingleSlug(unprefixedPath)) {
    const exactPost = findExactSlugMatch(postSlugMap, lang, trimmedSlug);
    if (exactPost) {
      return {
        newUrl: exactPost.new_url,
        confidence: "high",
        note: "Legacy post slug matches a current post slug exactly.",
      };
    }

    const aliasSlug = POST_SLUG_ALIAS_MAP[trimmedSlug];
    if (aliasSlug) {
      const aliasMatch = findExactSlugMatch(postSlugMap, lang, aliasSlug);
      if (aliasMatch) {
        return {
          newUrl: aliasMatch.new_url,
          confidence: "high",
          note: `Legacy post slug mapped through explicit alias (${aliasSlug}).`,
        };
      }
    }
  }

  return { newUrl: "", confidence: "", note: "" };
}

function inferKeepAndReason(row, oldType) {
  const status = String(row["HTTP status code"] ?? "");
  const isIndexable = lower(row["Is indexable page"]) === "true";
  const oldUrl = new URL(row.URL);
  const normalizedPath = normalizePath(oldUrl.pathname);
  const { unprefixedPath } = detectLangAndPath(normalizedPath);
  const duplicateCanonical = getDuplicateCanonical(unprefixedPath);

  if (status === "301") {
    return {
      keep: "no",
      reason: "Legacy URL already redirects; keep only for audit coverage.",
      reasonNote: "Included in the starter master even though it is not a live content page.",
    };
  }

  if (status === "404") {
    return {
      keep: "no",
      reason: "Legacy URL is already broken (404); keep only for error tracking.",
      reasonNote: "Included in the starter master because migration QA still needs visibility on legacy errors.",
    };
  }

  if (duplicateCanonical) {
    return {
      keep: "no",
      reason: "Clear duplicate or alias of another legacy URL.",
      reasonNote: `Canonical legacy counterpart: ${duplicateCanonical}.`,
    };
  }

  if (!isIndexable) {
    if (oldType === "legal") {
      return {
        keep: "no",
        reason: "Legal page is live but non-indexable in the old site.",
        reasonNote: "Legal URLs stay in the master for completeness but are not priority keep candidates.",
      };
    }

    if (oldType === "language_variant") {
      return {
        keep: "no",
        reason: "Language/root variant is not an indexable content page.",
        reasonNote: "",
      };
    }

    return {
      keep: "no",
      reason: "URL is live but non-indexable in the old site.",
      reasonNote: "Kept in the master for audit completeness, not as a primary migration candidate.",
    };
  }

  if (oldType === "home") {
    return {
      keep: "yes",
      reason: "Primary homepage candidate.",
      reasonNote: "",
    };
  }

  if (oldType === "blog_index") {
    return {
      keep: "yes",
      reason: "Public editorial index page.",
      reasonNote: "",
    };
  }

  if (oldType === "service_page") {
    return {
      keep: "yes",
      reason: "Business or transactional landing page.",
      reasonNote: "",
    };
  }

  if (oldType === "property") {
    return {
      keep: "yes",
      reason: "Property detail or property-related landing page.",
      reasonNote: "",
    };
  }

  if (oldType === "category") {
    return {
      keep: "maybe",
      reason: "Category archive needs review before consolidation or retirement.",
      reasonNote: "",
    };
  }

  if (oldType === "tag") {
    return {
      keep: "maybe",
      reason: "Tag archive needs review before consolidation or retirement.",
      reasonNote: "",
    };
  }

  if (oldType === "blog_pagination") {
    return {
      keep: "maybe",
      reason: "Pagination archive may be consolidated instead of recreated.",
      reasonNote: "",
    };
  }

  if (oldType === "legal") {
    return {
      keep: "no",
      reason: "Legal page is not a core keep candidate for migration.",
      reasonNote: "",
    };
  }

  if (oldType === "language_variant") {
    return {
      keep: "maybe",
      reason: "Language-specific legacy variant needs manual review.",
      reasonNote: "",
    };
  }

  return {
    keep: "yes",
    reason: "Informational or business content page worth manual migration review.",
    reasonNote: "",
  };
}

function selectInventoryColumns(row) {
  return {
    URL: row.URL,
    Title: row.Title,
    "HTTP status code": row["HTTP status code"],
    "Is indexable page": row["Is indexable page"],
    "No. of all inlinks": row["No. of all inlinks"],
    "Content type": row["Content type"],
  };
}

function toCsv(headers, rows) {
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const [inputRaw, masterAuditRaw] = await Promise.all([
    fs.readFile(INPUT_PATH, "utf16le"),
    fs.readFile(MASTER_AUDIT_PATH, "utf8"),
  ]);

  const inputRows = readRows(inputRaw, "\t");
  const masterRows = readRows(masterAuditRaw, ",");
  const htmlRows = inputRows.filter((row) => lower(row["Content type"]).includes("text/html"));

  const liveIndexable = htmlRows
    .filter((row) => String(row["HTTP status code"] ?? "") === "200")
    .filter((row) => lower(row["Is indexable page"]) === "true")
    .map(selectInventoryColumns);

  const liveNonindexable = htmlRows
    .filter((row) => String(row["HTTP status code"] ?? "") === "200")
    .filter((row) => lower(row["Is indexable page"]) === "false")
    .map(selectInventoryColumns);

  const legacyErrorsRedirects = htmlRows
    .filter((row) => ["301", "404"].includes(String(row["HTTP status code"] ?? "")))
    .map(selectInventoryColumns);

  const duplicateIndex = buildDuplicateIndex(htmlRows);
  const postSlugMap = buildExactSlugMap(masterRows, "post_detail");
  const propertySlugMap = buildExactSlugMap(masterRows, "property");

  const starterRows = htmlRows.map((row) => {
    const oldUrl = new URL(row.URL);
    const normalizedPath = normalizePath(oldUrl.pathname);
    const { lang } = detectLangAndPath(normalizedPath);
    const oldType = classifyOldType(row);
    const { keep, reason, reasonNote } = inferKeepAndReason(row, oldType);
    const { newUrl, confidence, note } = findObviousCandidate(row, masterRows, postSlugMap, propertySlugMap);

    return {
      old_url: row.URL,
      old_title: row.Title,
      old_status: row["HTTP status code"],
      old_indexable: row["Is indexable page"],
      old_inlinks: row["No. of all inlinks"],
      old_type: oldType,
      old_language: lang,
      keep_candidate: keep,
      reason,
      new_url_candidate: newUrl,
      match_confidence: confidence,
      notes: buildNotes({
        row,
        duplicateIndex,
        candidateNote: note,
        reasonNote,
      }),
    };
  });

  await Promise.all([
    fs.writeFile(path.join(OUTPUT_DIR, "old_urls_live_indexable.csv"), toCsv(INVENTORY_HEADERS, liveIndexable), "utf8"),
    fs.writeFile(path.join(OUTPUT_DIR, "old_urls_live_nonindexable.csv"), toCsv(INVENTORY_HEADERS, liveNonindexable), "utf8"),
    fs.writeFile(
      path.join(OUTPUT_DIR, "old_urls_legacy_errors_redirects.csv"),
      toCsv(INVENTORY_HEADERS, legacyErrorsRedirects),
      "utf8"
    ),
    fs.writeFile(path.join(OUTPUT_DIR, "migration_master_starter.csv"), toCsv(STARTER_HEADERS, starterRows), "utf8"),
  ]);

  console.log(
    JSON.stringify(
      {
        html_rows: htmlRows.length,
        live_indexable: liveIndexable.length,
        live_nonindexable: liveNonindexable.length,
        legacy_errors_redirects: legacyErrorsRedirects.length,
        starter_rows: starterRows.length,
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
