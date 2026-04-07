import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const MASTER_CSV_PATH = path.join(REPO_ROOT, "seo_url_audit_master.csv");
const LEGACY_INPUT_PATH = path.join(REPO_ROOT, "urls-antiguaweb.txt");
const OUTPUT_PATH = path.join(REPO_ROOT, "seo_url_legacy_redirect_map.csv");
const GAP_OUTPUT_PATH = path.join(REPO_ROOT, "seo_url_legacy_content_gaps.csv");
const SITE_URL = "https://blancareal.com";

type MasterRow = {
  new_url: string;
  lang: string;
  url_type: string;
  index_status: string;
  included_in_current_sitemap: string;
  canonical_target: string;
  source: string;
  entity_id: string;
  entity_slug: string;
  old_url: string;
  redirect_target: string;
  redirect_type: string;
  migration_status: string;
  priority: string;
  notes: string;
};

type LegacyRow = {
  old_url: string;
  old_path: string;
  detected_lang: string;
  old_type: string;
  matched_new_url: string;
  matched_new_type: string;
  redirect_type: string;
  migration_status: string;
  confidence: string;
  notes: string;
};

type GapRow = {
  old_url: string;
  old_type: string;
  current_target: string;
  current_target_type: string;
  target_index_status: string;
  gap_type: string;
  recommended_action: string;
  notes: string;
};

const headers: Array<keyof LegacyRow> = [
  "old_url",
  "old_path",
  "detected_lang",
  "old_type",
  "matched_new_url",
  "matched_new_type",
  "redirect_type",
  "migration_status",
  "confidence",
  "notes",
];

const gapHeaders: Array<keyof GapRow> = [
  "old_url",
  "old_type",
  "current_target",
  "current_target_type",
  "target_index_status",
  "gap_type",
  "recommended_action",
  "notes",
];

const supportedLangs = ["es", "en", "de", "fr", "it", "nl"] as const;
type SupportedLang = (typeof supportedLangs)[number];

const pageAliasMap: Record<string, { type: string; buildTarget: (lang: SupportedLang) => string; notes: string }> = {
  "/": {
    type: "home",
    buildTarget: (lang) => `/${lang}/`,
    notes: "Legacy root home.",
  },
  "/home/": {
    type: "home",
    buildTarget: (lang) => `/${lang}/`,
    notes: "Legacy home alias.",
  },
  "/blog/": {
    type: "post_index",
    buildTarget: (lang) => `/${lang}/posts/`,
    notes: "Legacy blog index.",
  },
  "/contact/": {
    type: "core",
    buildTarget: (lang) => `/${lang}/contact/`,
    notes: "Legacy contact page.",
  },
  "/contact-blancareal-costadel-sol/": {
    type: "core",
    buildTarget: (lang) => `/${lang}/contact/`,
    notes: "Legacy contact alias.",
  },
  "/about-us/": {
    type: "core",
    buildTarget: (lang) => `/${lang}/about/`,
    notes: "Legacy about page.",
  },
  "/about-us-2/": {
    type: "core",
    buildTarget: (lang) => `/${lang}/about/`,
    notes: "Legacy duplicate about page.",
  },
  "/property-search/": {
    type: "core",
    buildTarget: (lang) => `/${lang}/properties/`,
    notes: "Legacy catalogue/search page.",
  },
  "/property/": {
    type: "core",
    buildTarget: (lang) => `/${lang}/properties/`,
    notes: "Legacy property archive root.",
  },
  "/our-developments/": {
    type: "project",
    buildTarget: (lang) => `/${lang}/projects/`,
    notes: "Legacy developments index.",
  },
  "/our-developments-2/": {
    type: "project",
    buildTarget: (lang) => `/${lang}/projects/`,
    notes: "Legacy duplicate developments page.",
  },
  "/new-construction/": {
    type: "project",
    buildTarget: (lang) => `/${lang}/projects/`,
    notes: "Legacy new construction landing merged into projects index.",
  },
  "/second-hand/": {
    type: "core",
    buildTarget: (lang) => `/${lang}/properties/`,
    notes: "Legacy resale landing merged into catalogue.",
  },
  "/second-hand-2/": {
    type: "core",
    buildTarget: (lang) => `/${lang}/properties/`,
    notes: "Legacy duplicate resale landing merged into catalogue.",
  },
  "/rentals/": {
    type: "core",
    buildTarget: (lang) => `/${lang}/properties/`,
    notes: "Legacy rentals landing merged into catalogue.",
  },
  "/rentals-2/": {
    type: "core",
    buildTarget: (lang) => `/${lang}/properties/`,
    notes: "Legacy duplicate rentals landing merged into catalogue.",
  },
  "/vacation/": {
    type: "core",
    buildTarget: (lang) => `/${lang}/properties/`,
    notes: "Legacy vacation landing merged into catalogue.",
  },
  "/luxury-villas/": {
    type: "property_landing",
    buildTarget: (lang) => `/${lang}/properties/`,
    notes: "Legacy luxury villas page now falls back to main catalogue pending a dedicated landing decision.",
  },
  "/faqs/": {
    type: "other_public",
    buildTarget: (lang) => `/${lang}/contact/`,
    notes: "No direct FAQ equivalent in the new site; redirected to contact for now.",
  },
  "/services/": {
    type: "service",
    buildTarget: (lang) => `/${lang}/sell-with-us/`,
    notes: "Legacy generic services page now split across service pages; temporary redirect to the commercial entry point.",
  },
  "/es/sell-your-property/": {
    type: "service",
    buildTarget: () => "/es/sell-with-us/",
    notes: "Legacy Spanish sell page.",
  },
  "/es/comercializacion-inmobiliaria-costa-del-sol/": {
    type: "service",
    buildTarget: () => "/es/commercialization/",
    notes: "Legacy Spanish commercialization page.",
  },
  "/nl/onze-promoties/": {
    type: "project",
    buildTarget: () => "/nl/projects/",
    notes: "Legacy Dutch developments page.",
  },
};

const postSlugAliasMap: Record<string, string> = {
  "how-can-i-legally-rent-my-property-to-tourists-in-andalusia": "rent-your-home-to-tourists-andalucia",
  "legal-information-on-illegal-occupation-in-spain": "legal-information-illegal-occupation-spain",
  "dorronsoro-architeture-firm-behind-calahonda-sunset": "dorronsoro-architects-behind-calahonda-sunset",
  "we-sell-your-home-professional-mediation-with-in-house-legal-services-and-marketing": "sell-your-home-blancareal",
};

const propertySlugAliasMap: Record<string, string> = {
  "3-bedroom-apartment-beachfront-fuengirola": "3-bedroom-apartment-paseo-maritimo-fuengirola",
  "3-bedrooms-penthouse-las-lagunas-mijas": "3-bedroom-penthouse-las-lagunas-de-mijas",
  "amazing-duplex-penthouse-fuengirola": "4-bedroom-duplex-penthouse-fuengirola",
  "new-townhouses-san-pedro-de-alcantara": "townhouses-san-pedro-de-alcantara",
  "new-build-penthouse-los-pacos-fuengirola": "new-build-penthouse-fuengirola",
  "piso-1a-planta-avenida-carlos-haya-malaga": "1-bedroom-apartment-carlos-haya-malaga",
};

function csvEscape(value: string) {
  const normalized = String(value ?? "");
  if (/[",\n\r]/.test(normalized)) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
}

function parseCsv(content: string) {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

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

function readMasterRows(content: string) {
  const parsed = parseCsv(content);
  const [headerRow, ...dataRows] = parsed;
  return dataRows.map((row) => {
    const record = {} as MasterRow;
    headerRow.forEach((header, index) => {
      (record as any)[header] = row[index] ?? "";
    });
    return record;
  });
}

function normalizePath(pathname: string) {
  if (!pathname || pathname === "") return "/";
  let next = pathname;
  if (!next.startsWith("/")) next = `/${next}`;
  if (!next.endsWith("/")) next = `${next}/`;
  return next.replace(/\/+/g, "/");
}

function extractLegacyUrls(text: string) {
  const matches = text.match(/https:\/\/www\.blancareal\.com[^\s\t]+/g) ?? [];
  return Array.from(
    new Set(
      matches
        .map((url) => url.trim())
        .filter(Boolean)
        .filter((url) => !url.includes("sitemap"))
    )
  ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

function detectLangAndPath(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0] as SupportedLang | undefined;
  if (first && supportedLangs.includes(first)) {
    return {
      lang: first,
      unprefixedPath: normalizePath(`/${segments.slice(1).join("/")}`),
    };
  }
  return {
    lang: "en" as SupportedLang,
    unprefixedPath: normalizePath(pathname),
  };
}

function buildRow(
  oldUrl: string,
  oldType: string,
  detectedLang: string,
  targetUrl: string,
  targetType: string,
  migrationStatus: string,
  confidence: string,
  notes: string
): LegacyRow {
  return {
    old_url: oldUrl,
    old_path: normalizePath(new URL(oldUrl).pathname),
    detected_lang: detectedLang,
    old_type: oldType,
    matched_new_url: targetUrl,
    matched_new_type: targetType,
    redirect_type: targetUrl ? "301" : "",
    migration_status: migrationStatus,
    confidence,
    notes,
  };
}

function tokenizeSlug(slug: string) {
  return String(slug ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function jaccardScore(left: string, right: string) {
  const leftTokens = new Set(tokenizeSlug(left));
  const rightTokens = new Set(tokenizeSlug(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function buildAbsolute(pathname: string) {
  return `${SITE_URL}${pathname}`;
}

function findMasterRowByUrl(masterRows: MasterRow[], url: string) {
  return masterRows.find((row) => row.new_url === url) ?? null;
}

function findMasterRowBySlug(masterRows: MasterRow[], lang: string, urlType: string, slug: string) {
  return (
    masterRows.find(
      (row) => row.lang === lang && row.url_type === urlType && row.entity_slug === slug
    ) ?? null
  );
}

function inferLandingFromLegacyPropertySlug(slug: string) {
  const normalized = slug.toLowerCase();

  const citySlug = (() => {
    if (/(^|-)mijas($|-)|mijas-costa|las-lagunas|la-cala|calahonda/.test(normalized)) return "mijas";
    if (/fuengirola|torreblanca|los-boliches|los-pacos|el-higueron|paseo-maritimo/.test(normalized)) return "fuengirola";
    if (/marbella|nueva-andalucia|puerto-banus/.test(normalized)) return "marbella";
    if (/manilva|sotogrande/.test(normalized)) return "manilva";
    return null;
  })();

  if (!citySlug) return null;

  const areaSlug = (() => {
    if (/calahonda/.test(normalized)) return "calahonda";
    if (/las-lagunas/.test(normalized)) return "las-lagunas";
    if (/la-cala/.test(normalized)) return "la-cala";
    if (/torreblanca|los-pacos/.test(normalized)) return "torreblanca";
    if (/los-boliches/.test(normalized)) return "los-boliches";
    if (/nueva-andalucia/.test(normalized)) return "nueva-andalucia";
    if (/puerto-banus/.test(normalized)) return "puerto-banus";
    return null;
  })();

  const typeSlug = (() => {
    if (/\bvillas?\b|luxury-villa|villa-/.test(normalized)) return "villas";
    if (/townhouse|townhouses|houses|house-for-sale|casas|adosados|adosada/.test(normalized)) return "casas";
    if (/apartments|apartment|flats|flat|pisos|piso|penthouse|penthouses/.test(normalized)) return "pisos";
    return null;
  })();

  const searchSlug = (() => {
    if (/sea-view|sea-views|panoramic-views|vistas-al-mar|meerblick/.test(normalized)) return "sea-view";
    if (/new-build|new-construction|newly-built|offplan|obra-nueva/.test(normalized)) return "new-build";
    if (/pool/.test(normalized)) return "pool";
    if (/luxury-villas/.test(normalized)) return "villas-de-lujo";
    return null;
  })();

  if (searchSlug) {
    return `${citySlug}/search/${searchSlug}`;
  }

  if (areaSlug && typeSlug) {
    return `${citySlug}/${areaSlug}/${typeSlug}`;
  }

  if (areaSlug) {
    return `${citySlug}/${areaSlug}`;
  }

  if (typeSlug) {
    return `${citySlug}/${typeSlug}`;
  }

  return citySlug;
}

function findSemanticPropertyMatch(masterRows: MasterRow[], lang: string, slug: string) {
  const normalized = slug.toLowerCase();

  const directAliasSlug = propertySlugAliasMap[normalized];
  if (directAliasSlug) {
    const directAlias = findMasterRowBySlug(masterRows, lang, "property", directAliasSlug);
    if (directAlias) {
      return {
        row: directAlias,
        migrationStatus: "mapped_equivalent",
        confidence: "high",
        notes: `Legacy property slug mapped through explicit alias (${directAliasSlug}).`,
      };
    }
  }

  const projectKeywordCandidates = [
    {
      test: /almitak|orion-collection/,
      targetSlug: "new-build-almitak-mijas",
      notes: "Legacy property clearly belongs to the Almitak project.",
    },
    {
      test: /calahonda-sunset/,
      targetSlug: "new-build-calahonda-sunset-mijas",
      notes: "Legacy property clearly belongs to the Calahonda Sunset project.",
    },
    {
      test: /nylva|sotogrande/,
      targetSlug: "new-build-nylva-homes-manilva",
      notes: "Legacy property clearly belongs to the Nylva Homes project.",
    },
    {
      test: /arenal-golf/,
      targetSlug: "top-floor-apartment-arenal-golf-benalmadena",
      notes: "Legacy property clearly matches the Arenal Golf listing.",
    },
  ];

  for (const candidate of projectKeywordCandidates) {
    if (!candidate.test.test(normalized)) continue;
    const matched = findMasterRowBySlug(masterRows, lang, "property", candidate.targetSlug);
    if (matched) {
      return {
        row: matched,
        migrationStatus: "mapped_equivalent",
        confidence: "medium",
        notes: candidate.notes,
      };
    }
  }

  if (/san-pedro/.test(normalized)) {
    const sanPedroSlug =
      /\b3-bedrooms?\b|\b3-bedroom\b/.test(normalized)
        ? "3-bedroom-apartment-san-pedro-de-alcantara"
        : /\b2-bedrooms?\b|\b2-bedroom\b/.test(normalized)
          ? "2-bedroom-apartment-san-pedro-de-alcantara"
          : /villa/.test(normalized)
            ? "villas-san-pedro-de-alcantara"
            : /townhouse|townhouses/.test(normalized)
              ? "townhouses-san-pedro-de-alcantara"
              : "apartment-san-pedro-de-alcantara";

    const matched = findMasterRowBySlug(masterRows, lang, "property", sanPedroSlug);
    if (matched) {
      return {
        row: matched,
        migrationStatus: "mapped_equivalent",
        confidence: "medium",
        notes: `Legacy San Pedro property mapped to the closest current San Pedro listing (${sanPedroSlug}).`,
      };
    }
  }

  const inferredLandingSlug = inferLandingFromLegacyPropertySlug(normalized);
  if (inferredLandingSlug) {
    const landing = findMasterRowBySlug(masterRows, lang, "property_landing", inferredLandingSlug);
    if (landing) {
      return {
        row: landing,
        migrationStatus: "mapped_equivalent",
        confidence: landing.index_status === "indexable" ? "medium" : "low",
        notes:
          landing.index_status === "indexable"
            ? `Legacy property behaves like a search landing and maps to ${inferredLandingSlug}.`
            : `Legacy property behaves like a search landing and maps to ${inferredLandingSlug}, but the current target is still noindex.`,
      };
    }
  }

  let bestMatch: MasterRow | null = null;
  let bestScore = 0;
  let secondBestScore = 0;

  for (const candidate of masterRows.filter((row) => row.lang === lang && row.url_type === "property")) {
    const score = jaccardScore(normalized, candidate.entity_slug);
    if (score > bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestMatch = candidate;
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  if (bestMatch && bestScore >= 0.68 && bestScore - secondBestScore >= 0.14) {
    return {
      row: bestMatch,
      migrationStatus: "mapped_equivalent",
      confidence: "medium",
      notes: `Legacy property slug mapped heuristically to current property slug (${bestMatch.entity_slug}).`,
    };
  }

  return null;
}

async function main() {
  const [masterCsv, legacyRaw] = await Promise.all([
    fs.readFile(MASTER_CSV_PATH, "utf8"),
    fs.readFile(LEGACY_INPUT_PATH, "utf8"),
  ]);

  const masterRows = readMasterRows(masterCsv);
  const legacyUrls = extractLegacyUrls(legacyRaw);

  const newByUrl = new Map(masterRows.map((row) => [row.new_url, row]));
  const postRows = masterRows.filter((row) => row.url_type === "post_detail");
  const propertyRows = masterRows.filter((row) => row.url_type === "property");
  const exactBySlug = new Map<string, MasterRow[]>();

  for (const row of [...postRows, ...propertyRows]) {
    const key = `${row.url_type}:${row.lang}:${row.entity_slug}`;
    const existing = exactBySlug.get(key) ?? [];
    existing.push(row);
    exactBySlug.set(key, existing);
  }

  const results: LegacyRow[] = [];

  for (const oldUrl of legacyUrls) {
    const url = new URL(oldUrl);
    const normalizedPath = normalizePath(url.pathname);
    const { lang, unprefixedPath } = detectLangAndPath(normalizedPath);

    if (normalizedPath === "/" && url.searchParams.has("page_id")) {
      results.push(
        buildRow(
          oldUrl,
          "page",
          lang,
          "",
          "",
          "needs_manual_decision",
          "low",
          "Legacy WordPress page_id URL requires manual identification."
        )
      );
      continue;
    }

    if (normalizedPath === "/" && url.searchParams.get("post_type") === "property") {
      results.push(
        buildRow(
          oldUrl,
          "property",
          lang,
          `${SITE_URL}/${lang}/properties/`,
          "core",
          "merge_to_parent",
          "medium",
          "Legacy WordPress property ID URL merged into main catalogue."
        )
      );
      continue;
    }

    if (pageAliasMap[normalizedPath]) {
      const alias = pageAliasMap[normalizedPath];
      const targetPath = alias.buildTarget(lang);
      const targetUrl = `${SITE_URL}${targetPath}`;
      const matched = newByUrl.get(targetUrl);
      results.push(
        buildRow(
          oldUrl,
          alias.type,
          lang,
          targetUrl,
          matched?.url_type ?? alias.type,
          "mapped_equivalent",
          "high",
          alias.notes
        )
      );
      continue;
    }

    if (unprefixedPath.startsWith("/category/")) {
      const targetUrl = `${SITE_URL}/${lang}/posts/`;
      results.push(
        buildRow(
          oldUrl,
          "category",
          lang,
          targetUrl,
          "post_index",
          "merge_to_parent",
          "high",
          "Legacy post category archive merged into posts index."
        )
      );
      continue;
    }

    if (unprefixedPath.startsWith("/property/")) {
      const slug = unprefixedPath.replace(/^\/property\//, "").replace(/\/$/, "");
      const exactMatches = exactBySlug.get(`property:${lang}:${slug}`) ?? [];

      if (exactMatches.length === 1) {
        results.push(
          buildRow(
            oldUrl,
            "property",
            lang,
            exactMatches[0].new_url,
            exactMatches[0].url_type,
            "exact_match",
            "high",
            "Legacy property slug matches current property slug exactly."
          )
        );
        continue;
      }

      const semanticMatch = findSemanticPropertyMatch(masterRows, lang, slug);
      if (semanticMatch) {
        results.push(
          buildRow(
            oldUrl,
            "property",
            lang,
            semanticMatch.row.new_url,
            semanticMatch.row.url_type,
            semanticMatch.migrationStatus,
            semanticMatch.confidence,
            semanticMatch.notes
          )
        );
        continue;
      }

      results.push(
        buildRow(
          oldUrl,
          "property",
          lang,
          `${SITE_URL}/${lang}/properties/`,
          "core",
          "merge_to_parent",
          "medium",
          "No trustworthy property-level match found; redirecting to the catalogue."
        )
      );
      continue;
    }

    const trimmedSlug = unprefixedPath.replace(/^\/|\/$/g, "");
    if (trimmedSlug && !trimmedSlug.includes("/")) {
      const mappedPostSlug = postSlugAliasMap[trimmedSlug] ?? trimmedSlug;
      const postMatches = exactBySlug.get(`post_detail:${lang}:${mappedPostSlug}`) ?? [];

      if (postMatches.length === 1) {
        const exactStatus = mappedPostSlug === trimmedSlug ? "exact_match" : "mapped_equivalent";
        const exactNotes =
          mappedPostSlug === trimmedSlug
            ? "Legacy post slug matches current post slug exactly."
            : `Legacy post slug mapped to current post slug alias (${mappedPostSlug}).`;
        results.push(
          buildRow(
            oldUrl,
            "post",
            lang,
            postMatches[0].new_url,
            postMatches[0].url_type,
            exactStatus,
            mappedPostSlug === trimmedSlug ? "high" : "medium",
            exactNotes
          )
        );
        continue;
      }

      results.push(
        buildRow(
          oldUrl,
          "post",
          lang,
          `${SITE_URL}/${lang}/posts/`,
          "post_index",
          "merge_to_parent",
          "low",
          "Legacy post has no direct equivalent in the current editorial set; redirected to posts index."
        )
      );
      continue;
    }

    results.push(
      buildRow(
        oldUrl,
        "other_public",
        lang,
        "",
        "",
        "needs_manual_decision",
        "low",
        "No automatic mapping rule matched this legacy URL."
      )
    );
  }

  const csv = [
    headers.join(","),
    ...results.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");

  await fs.writeFile(OUTPUT_PATH, csv, "utf8");

  const gaps: GapRow[] = results
    .map((row) => {
      const target = row.matched_new_url ? findMasterRowByUrl(masterRows, row.matched_new_url) : null;

      if (row.migration_status === "exact_match") {
        return null;
      }

      if (row.migration_status === "merge_to_parent") {
        return {
          old_url: row.old_url,
          old_type: row.old_type,
          current_target: row.matched_new_url,
          current_target_type: row.matched_new_type,
          target_index_status: target?.index_status ?? "",
          gap_type: "content_missing_exact_equivalent",
          recommended_action:
            row.old_type === "post"
              ? "Recreate or migrate the old article if this URL had organic traffic or backlinks."
              : "Create a dedicated equivalent page or project/landing if this URL had organic traffic or backlinks.",
          notes: row.notes,
        } satisfies GapRow;
      }

      if (target?.index_status === "noindex") {
        return {
          old_url: row.old_url,
          old_type: row.old_type,
          current_target: row.matched_new_url,
          current_target_type: row.matched_new_type,
          target_index_status: target.index_status,
          gap_type: "target_currently_noindex",
          recommended_action:
            "Review whether the target page should be made indexable before launch to preserve SEO intent.",
          notes: row.notes,
        } satisfies GapRow;
      }

      return null;
    })
    .filter((row): row is GapRow => Boolean(row));

  const gapCsv = [
    gapHeaders.join(","),
    ...gaps.map((row) => gapHeaders.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");

  await fs.writeFile(GAP_OUTPUT_PATH, gapCsv, "utf8");

  const summary = results.reduce<Record<string, number>>((acc, row) => {
    acc[row.migration_status] = (acc[row.migration_status] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`Generated ${results.length} legacy mappings at ${path.relative(REPO_ROOT, OUTPUT_PATH)}`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Generated ${gaps.length} content-gap rows at ${path.relative(REPO_ROOT, GAP_OUTPUT_PATH)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
