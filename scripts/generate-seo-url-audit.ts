import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SEO_LANDING_CITIES, SEO_LANDING_RULES, SEO_LANDING_TYPES } from "../src/config/seoSlugs.ts";
import { SUPPORTED_LANGS, DEFAULT_LANG } from "../src/i18n/languages.ts";
import { CITIES, TYPES } from "../src/data/properties/taxonomies.ts";
import { normalizePm0074PublicProperty } from "../src/utils/normalizePm0074PublicProperty.ts";

const SITE_URL = "https://blancareal.com";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const CSV_OUTPUT_PATH = path.join(REPO_ROOT, "seo_url_audit_master.csv");

type CsvRow = {
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

type LandingModel = {
  kind: "city" | "city-area" | "city-type" | "city-area-type" | "city-popular";
  seoKey: string;
  canonicalPath: string;
  indexable: boolean;
  minResults: number;
  queryFilters: {
    city: string[] | null;
    area: string[] | null;
    type: string[] | null;
    market: string | null;
    feature: string[] | null;
    priceMin: number | null;
  };
};

type LandingEligibility = {
  landing: LandingModel;
  resultCount: number;
  isIndexable: boolean;
  showInHub: boolean;
  showInSitemap: boolean;
  status: "keep" | "keep_nohub" | "remove";
};

type NormalizedLandingCard = {
  visible: boolean;
  status: string;
  listingType: string;
  isPromotion: boolean;
  parentId: string | null;
  price: number | null;
  cityKey: string | null;
  areaKey: string | null;
  typeKey: string | null;
  marketKey: string | null;
  featureKeys: string[];
};

const DEFAULT_MIN_RESULTS = 3;
const defaultPublicationByKind = {
  city: { enabled: true, showInHub: true, showInSitemap: true, minHubResults: 3 },
  "city-area": { enabled: true, showInHub: true, showInSitemap: true, minHubResults: 3 },
  "city-type": { enabled: true, showInHub: true, showInSitemap: true, minHubResults: 3 },
  "city-area-type": { enabled: true, showInHub: false, showInSitemap: false, minHubResults: 3 },
  "city-popular": { enabled: true, showInHub: false, showInSitemap: false, minHubResults: 3 },
} as const;

const sitemapStaticPathsByLang = new Map<string, Set<string>>();

const csvHeaders: Array<keyof CsvRow> = [
  "new_url",
  "lang",
  "url_type",
  "index_status",
  "included_in_current_sitemap",
  "canonical_target",
  "source",
  "entity_id",
  "entity_slug",
  "old_url",
  "redirect_target",
  "redirect_type",
  "migration_status",
  "priority",
  "notes",
];

const staticRouteTemplates = [
  {
    path: (lang: string) => `/${lang}/`,
    urlType: "home",
    indexStatus: "indexable",
    source: "static_route",
    priority: "critical",
    notes: "Homepage per language.",
    inSitemap: true,
  },
  {
    path: (lang: string) => `/${lang}/about/`,
    urlType: "core",
    indexStatus: "indexable",
    source: "static_route",
    priority: "medium",
    notes: "Corporate about page; public but not currently in sitemap.",
    inSitemap: false,
  },
  {
    path: (lang: string) => `/${lang}/properties/`,
    urlType: "core",
    indexStatus: "indexable",
    source: "static_route",
    priority: "critical",
    notes: "Main catalogue index.",
    inSitemap: true,
  },
  {
    path: (lang: string) => `/${lang}/real-estate/`,
    urlType: "core",
    indexStatus: "canonical_redirect",
    source: "static_route",
    priority: "high",
    notes: "Public legacy alias that redirects to the main catalogue.",
    inSitemap: false,
    canonicalTarget: (lang: string) => `/${lang}/properties/`,
  },
  {
    path: (lang: string) => `/${lang}/legal-services/`,
    urlType: "service",
    indexStatus: "indexable",
    source: "static_route",
    priority: "high",
    notes: "Public service page.",
    inSitemap: true,
  },
  {
    path: (lang: string) => `/${lang}/commercialization/`,
    urlType: "service",
    indexStatus: "indexable",
    source: "static_route",
    priority: "high",
    notes: "Public service page.",
    inSitemap: true,
  },
  {
    path: (lang: string) => `/${lang}/sell-with-us/`,
    urlType: "service",
    indexStatus: "indexable",
    source: "static_route",
    priority: "high",
    notes: "Public service page.",
    inSitemap: true,
  },
  {
    path: (lang: string) => `/${lang}/marketing-3d/`,
    urlType: "service",
    indexStatus: "indexable",
    source: "static_route",
    priority: "medium",
    notes: "Public service page not currently present in sitemap.",
    inSitemap: false,
  },
  {
    path: (lang: string) => `/${lang}/agents/`,
    urlType: "agent_index",
    indexStatus: "indexable",
    source: "static_route",
    priority: "high",
    notes: "Agent directory index.",
    inSitemap: true,
  },
  {
    path: (lang: string) => `/${lang}/posts/`,
    urlType: "post_index",
    indexStatus: "indexable",
    source: "static_route",
    priority: "high",
    notes: "Editorial index page.",
    inSitemap: true,
  },
  {
    path: (lang: string) => `/${lang}/contact/`,
    urlType: "core",
    indexStatus: "indexable",
    source: "static_route",
    priority: "high",
    notes: "Primary contact page.",
    inSitemap: true,
  },
  {
    path: (lang: string) => `/${lang}/projects/`,
    urlType: "project",
    indexStatus: "indexable",
    source: "static_route",
    priority: "high",
    notes: "Project showcase index.",
    inSitemap: true,
  },
  {
    path: (lang: string) => `/${lang}/legal/privacy/`,
    urlType: "legal",
    indexStatus: "indexable",
    source: "static_route",
    priority: "medium",
    notes: "Public legal page; not currently in sitemap.",
    inSitemap: false,
  },
  {
    path: (lang: string) => `/${lang}/legal/cookies/`,
    urlType: "legal",
    indexStatus: "indexable",
    source: "static_route",
    priority: "medium",
    notes: "Public legal page; not currently in sitemap.",
    inSitemap: false,
  },
] as const;

const futureTemplateTypes = [
  {
    urlType: "post_detail",
    buildPath: (lang: string) => `/${lang}/post/__future-post-slug__/`,
    notes: "Future editorial article template row.",
  },
  {
    urlType: "property",
    buildPath: (lang: string) => `/${lang}/property/__future-property-slug__/`,
    notes: "Future property detail template row.",
  },
  {
    urlType: "property_landing",
    buildPath: (lang: string) => `/${lang}/properties/__future-landing-slug__/`,
    notes: "Future SEO landing template row.",
  },
  {
    urlType: "agent_detail",
    buildPath: (lang: string) => `/${lang}/agents/__future-agent-slug__/`,
    notes: "Future agent detail template row.",
  },
  {
    urlType: "service",
    buildPath: (lang: string) => `/${lang}/__future-service-slug__/`,
    notes: "Future public service or corporate page template row.",
  },
] as const;

function toAbsoluteUrl(pathname: string) {
  return `${SITE_URL}${pathname}`;
}

function csvEscape(value: string) {
  const normalized = String(value ?? "");
  if (/[",\n\r]/.test(normalized)) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
}

function normalizeSlug(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "");
}

function normalizeCity(raw?: string | null) {
  if (!raw) return null;
  return raw
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

function normalizeArea(raw?: string | null) {
  if (!raw) return null;
  const value = raw.toLowerCase();
  if (value.includes("cala")) return "la_cala_de_mijas";
  if (value.includes("lagunas")) return "las_lagunas_de_mijas";
  if (value.includes("torreblanca")) return "torreblanca";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

function matchType(rawType?: string | null) {
  if (!rawType) return null;
  const value = rawType.toLowerCase();
  for (const [key, definition] of Object.entries(TYPES)) {
    if (definition.match.some((match) => match === value)) {
      return key;
    }
  }
  return null;
}

function slugifyName(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

async function readJsonDirectory(directoryPath: string) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));

  const records = await Promise.all(
    files.map(async (fileName) => {
      const filePath = path.join(directoryPath, fileName);
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw);
    })
  );

  return records;
}

function buildSitemapStaticLookup() {
  for (const lang of SUPPORTED_LANGS) {
    sitemapStaticPathsByLang.set(
      lang,
      new Set([
        `/${lang}/`,
        `/${lang}/properties/`,
        `/${lang}/legal-services/`,
        `/${lang}/commercialization/`,
        `/${lang}/sell-with-us/`,
        `/${lang}/agents/`,
        `/${lang}/contact/`,
        `/${lang}/projects/`,
        `/${lang}/posts/`,
      ])
    );
  }
}

function buildStaticRows() {
  const rows: CsvRow[] = [
    {
      new_url: toAbsoluteUrl("/"),
      lang: "global",
      url_type: "other_public",
      index_status: "canonical_redirect",
      included_in_current_sitemap: "no",
      canonical_target: toAbsoluteUrl(`/${DEFAULT_LANG}/`),
      source: "static_route",
      entity_id: "root_redirect",
      entity_slug: "",
      old_url: "",
      redirect_target: "",
      redirect_type: "",
      migration_status: "pending_legacy_mapping",
      priority: "critical",
      notes: `Root path redirects to the default language homepage (${DEFAULT_LANG}).`,
    },
  ];

  for (const lang of SUPPORTED_LANGS) {
    for (const route of staticRouteTemplates) {
      const pathname = route.path(lang);
      const canonicalPath = route.canonicalTarget ? route.canonicalTarget(lang) : pathname;
      rows.push({
        new_url: toAbsoluteUrl(pathname),
        lang,
        url_type: route.urlType,
        index_status: route.indexStatus,
        included_in_current_sitemap: route.inSitemap ? "yes" : "no",
        canonical_target: toAbsoluteUrl(canonicalPath),
        source: route.source,
        entity_id: pathname,
        entity_slug: pathname.replace(new RegExp(`^/${lang}/?`), "").replace(/\/$/g, ""),
        old_url: "",
        redirect_target: "",
        redirect_type: "",
        migration_status: "pending_legacy_mapping",
        priority: route.priority,
        notes: route.notes,
      });
    }
  }

  return rows;
}

function normalizePropertyForLanding(property: any, lang: string): NormalizedLandingCard | null {
  if (!property || typeof property !== "object") return null;

  const translation = property.translations?.[lang] ?? {};
  const title = typeof translation.title === "string" ? translation.title.trim() : "";
  const slug = typeof property.slugs?.[lang] === "string" ? property.slugs[lang].trim() : "";
  if (!title || !slug) return null;

  const status = String(property.status ?? "available");
  const listingType = String(property.listing_type ?? "unit");
  const location = property.location ?? {};

  return {
    visible: status !== "private",
    status,
    listingType,
    isPromotion: listingType === "promotion",
    parentId: property.parent_id ? String(property.parent_id) : null,
    price: listingType === "promotion" ? null : (typeof property.price === "number" ? property.price : null),
    cityKey: normalizeCity(location.city),
    areaKey: normalizeArea(location.area),
    typeKey: matchType(property.property?.type),
    marketKey: typeof property.property?.market === "string" ? property.property.market : null,
    featureKeys: Array.isArray(property.features)
      ? property.features.filter((item: unknown) => typeof item === "string")
      : [],
  };
}

function buildVisibleLandingCards(properties: any[], lang: string) {
  return properties
    .map((property) => normalizePropertyForLanding(property, lang))
    .filter((card): card is NormalizedLandingCard => Boolean(card))
    .filter((card) => card.visible);
}

function dedupeSlugSegments(entries: string[][]) {
  const seen = new Set<string>();
  return entries.filter((segments) => {
    const key = segments.join("/");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildAllPropertyLandingSlugSegments() {
  return dedupeSlugSegments(
    SEO_LANDING_CITIES.flatMap((city) => [
      [city.slug],
      ...city.areas.map((area) => [city.slug, area.slug]),
      ...city.typeSlugs.map((typeSlug) => [city.slug, typeSlug]),
      ...city.areas.flatMap((area) =>
        (area.typeSlugs && area.typeSlugs.length ? area.typeSlugs : city.typeSlugs).map((typeSlug) => [
          city.slug,
          area.slug,
          typeSlug,
        ])
      ),
      ...city.popularSearches.map((popular) => [city.slug, "search", popular.slug]),
    ])
  );
}

function matchesSlug(value: string, config: { slug: string; aliases?: string[] }) {
  return value === config.slug || Boolean(config.aliases?.includes(value));
}

function buildLandingModel(input: {
  kind: LandingModel["kind"];
  lang: string;
  slugSegments: string[];
  minResults: number;
  queryFilters: LandingModel["queryFilters"];
}) {
  const seoKey = input.slugSegments.join("/");
  const ruleConfig = SEO_LANDING_RULES[seoKey];
  return {
    kind: input.kind,
    seoKey,
    canonicalPath: `/${input.lang}/properties/${input.slugSegments.join("/")}/`,
    indexable: ruleConfig?.enabled !== false,
    minResults: ruleConfig?.minResults ?? input.minResults,
    queryFilters: input.queryFilters,
  } satisfies LandingModel;
}

function resolvePropertyLanding(lang: string, slugSegments: string[]): LandingModel | null {
  const segments = Array.isArray(slugSegments)
    ? slugSegments.map(normalizeSlug).filter(Boolean)
    : [];

  if (segments.length === 0 || segments.length > 3) {
    return null;
  }

  const cityConfig = SEO_LANDING_CITIES.find((city) => city.slug === segments[0]);
  if (!cityConfig) return null;

  if (segments.length === 1) {
    return buildLandingModel({
      kind: "city",
      lang,
      slugSegments: [cityConfig.slug],
      minResults: cityConfig.minResults ?? DEFAULT_MIN_RESULTS,
      queryFilters: {
        city: [cityConfig.cityKey],
        area: null,
        type: null,
        market: null,
        feature: null,
        priceMin: null,
      },
    });
  }

  const secondSegment = segments[1];
  const areaConfig = cityConfig.areas.find((area) => matchesSlug(secondSegment, area));
  const typeConfig = SEO_LANDING_TYPES.find(
    (type) => matchesSlug(secondSegment, type) && cityConfig.typeSlugs.includes(type.slug)
  );

  if (segments.length === 2 && areaConfig) {
    return buildLandingModel({
      kind: "city-area",
      lang,
      slugSegments: [cityConfig.slug, areaConfig.slug],
      minResults: areaConfig.minResults ?? cityConfig.minResults ?? DEFAULT_MIN_RESULTS,
      queryFilters: {
        city: [cityConfig.cityKey],
        area: [areaConfig.areaKey],
        type: null,
        market: null,
        feature: null,
        priceMin: null,
      },
    });
  }

  if (segments.length === 2 && typeConfig) {
    return buildLandingModel({
      kind: "city-type",
      lang,
      slugSegments: [cityConfig.slug, typeConfig.slug],
      minResults: typeConfig.minResults ?? cityConfig.minResults ?? DEFAULT_MIN_RESULTS,
      queryFilters: {
        city: [cityConfig.cityKey],
        area: null,
        type: [typeConfig.typeKey],
        market: null,
        feature: null,
        priceMin: null,
      },
    });
  }

  if (segments.length === 3 && secondSegment === "search") {
    const popularConfig = cityConfig.popularSearches.find((item) => item.slug === segments[2]);
    if (!popularConfig) return null;

    return buildLandingModel({
      kind: "city-popular",
      lang,
      slugSegments: [cityConfig.slug, "search", popularConfig.slug],
      minResults: popularConfig.minResults ?? cityConfig.minResults ?? DEFAULT_MIN_RESULTS,
      queryFilters: {
        city: [cityConfig.cityKey],
        area: null,
        type: popularConfig.typeKey ? [popularConfig.typeKey] : null,
        market: popularConfig.marketKey ?? null,
        feature: popularConfig.featureKey ? [popularConfig.featureKey] : null,
        priceMin: typeof popularConfig.priceMin === "number" ? popularConfig.priceMin : null,
      },
    });
  }

  if (segments.length === 3 && areaConfig) {
    const thirdSegment = segments[2];
    const areaTypeSlugs =
      areaConfig.typeSlugs && areaConfig.typeSlugs.length ? areaConfig.typeSlugs : cityConfig.typeSlugs;
    const nestedTypeConfig = SEO_LANDING_TYPES.find(
      (type) => matchesSlug(thirdSegment, type) && areaTypeSlugs.includes(type.slug)
    );
    if (!nestedTypeConfig) return null;

    return buildLandingModel({
      kind: "city-area-type",
      lang,
      slugSegments: [cityConfig.slug, areaConfig.slug, nestedTypeConfig.slug],
      minResults:
        nestedTypeConfig.minResults ??
        areaConfig.minResults ??
        cityConfig.minResults ??
        DEFAULT_MIN_RESULTS,
      queryFilters: {
        city: [cityConfig.cityKey],
        area: [areaConfig.areaKey],
        type: [nestedTypeConfig.typeKey],
        market: null,
        feature: null,
        priceMin: null,
      },
    });
  }

  return null;
}

function buildAllPropertyLandings(lang: string) {
  return buildAllPropertyLandingSlugSegments()
    .map((slugSegments) => resolvePropertyLanding(lang, slugSegments))
    .filter((landing): landing is LandingModel => Boolean(landing));
}

function mergePublicationConfig(
  base: { enabled: boolean; showInHub: boolean; showInSitemap: boolean; minHubResults: number },
  ...sources: Array<Record<string, any> | null | undefined>
) {
  return sources.reduce(
    (acc, source) => {
      if (!source) return acc;
      return {
        enabled: source.enabled ?? acc.enabled,
        showInHub: source.showInHub ?? acc.showInHub,
        showInSitemap: source.showInSitemap ?? acc.showInSitemap,
        minHubResults: source.minHubResults ?? acc.minHubResults,
      };
    },
    { ...base }
  );
}

function resolveLandingPublicationConfig(landing: LandingModel) {
  const cityConfig = SEO_LANDING_CITIES.find((city) => city.slug === landing.seoKey.split("/")[0]);
  const areaSlug = landing.seoKey.split("/")[1];
  const typeSlug = landing.kind === "city-area-type" ? landing.seoKey.split("/")[2] : areaSlug;
  const popularSlug = landing.kind === "city-popular" ? landing.seoKey.split("/")[2] : null;
  const areaConfig = cityConfig?.areas.find((area) => area.slug === areaSlug);
  const typeConfig = SEO_LANDING_TYPES.find((type) => type.slug === typeSlug);
  const popularConfig = cityConfig?.popularSearches.find((popular) => popular.slug === popularSlug);
  const ruleConfig = SEO_LANDING_RULES[landing.seoKey];

  return mergePublicationConfig(
    defaultPublicationByKind[landing.kind],
    cityConfig,
    areaConfig,
    typeConfig,
    popularConfig,
    ruleConfig
  );
}

function applyLandingFilters(cards: NormalizedLandingCard[], filters: LandingModel["queryFilters"]) {
  const hasUnitFilters = typeof filters.priceMin === "number";

  return cards.filter((card) => {
    if (!card.visible) return false;
    if (card.status === "sold") return false;

    if (!hasUnitFilters) {
      if (card.listingType === "unit" && card.parentId) {
        return false;
      }
    } else if (card.isPromotion) {
      return false;
    }

    if (filters.city) {
      const cities = Array.isArray(filters.city) ? filters.city : [filters.city];
      if (!cities.includes(card.cityKey ?? "")) return false;
    }

    if (filters.area) {
      const areas = Array.isArray(filters.area) ? filters.area : [filters.area];
      if (!areas.includes(card.areaKey ?? "")) return false;
    }

    if (filters.type) {
      const types = Array.isArray(filters.type) ? filters.type : [filters.type];
      if (!types.includes(card.typeKey ?? "")) return false;
    }

    if (filters.feature) {
      const features = Array.isArray(filters.feature) ? filters.feature : [filters.feature];
      if (!features.every((feature) => card.featureKeys.includes(feature))) return false;
    }

    if (filters.market && card.marketKey !== filters.market) {
      return false;
    }

    if (
      typeof filters.priceMin === "number" &&
      typeof card.price === "number" &&
      card.price < filters.priceMin
    ) {
      return false;
    }

    return true;
  });
}

function evaluateLandings(lang: string, cards: NormalizedLandingCard[]) {
  return buildAllPropertyLandings(lang).map((landing) => {
    const publication = resolveLandingPublicationConfig(landing);
    const resultCount = applyLandingFilters(cards, landing.queryFilters).length;
    const isIndexable = publication.enabled && landing.indexable && resultCount >= landing.minResults;
    const showInHub = isIndexable && publication.showInHub && resultCount >= publication.minHubResults;
    const showInSitemap = isIndexable && publication.showInSitemap;
    const status =
      !publication.enabled || resultCount === 0
        ? "remove"
        : showInHub || showInSitemap
          ? "keep"
          : "keep_nohub";

    return {
      landing,
      resultCount,
      isIndexable,
      showInHub,
      showInSitemap,
      status,
    } satisfies LandingEligibility;
  });
}

function buildPropertyRows(properties: any[]) {
  const rows: CsvRow[] = [];

  for (const lang of SUPPORTED_LANGS) {
    for (const property of properties) {
      const slug = typeof property.slugs?.[lang] === "string" ? property.slugs[lang].trim() : "";
      if (!slug) continue;

      const status = String(property.status ?? "available");
      const visible = status !== "private";
      if (!visible) continue;

      const translatedSeo = property.translations?.[lang]?.seo ?? {};
      const noindex = Boolean(
        typeof translatedSeo.noindex === "boolean"
          ? translatedSeo.noindex
          : status === "sold" || status === "private"
      );
      const pathname = `/${lang}/property/${slug}/`;

      rows.push({
        new_url: toAbsoluteUrl(pathname),
        lang,
        url_type: "property",
        index_status: noindex ? "noindex" : "indexable",
        included_in_current_sitemap: !noindex ? "yes" : "no",
        canonical_target: toAbsoluteUrl(pathname),
        source: "dynamic_properties",
        entity_id: String(property.id ?? ""),
        entity_slug: slug,
        old_url: "",
        redirect_target: "",
        redirect_type: "",
        migration_status: "pending_legacy_mapping",
        priority: noindex ? "medium" : "high",
        notes: [
          `listing_type=${String(property.listing_type ?? "unit")}`,
          `status=${status}`,
          noindex ? "public detail kept as noindex." : "public indexable detail URL.",
        ].join(" "),
      });
    }
  }

  return rows;
}

function buildLandingRows(properties: any[]) {
  const rows: CsvRow[] = [];

  for (const lang of SUPPORTED_LANGS) {
    const cards = buildVisibleLandingCards(properties, lang);
    const eligibilityEntries = evaluateLandings(lang, cards);

    for (const entry of eligibilityEntries) {
      rows.push({
        new_url: toAbsoluteUrl(entry.landing.canonicalPath),
        lang,
        url_type: "property_landing",
        index_status: entry.isIndexable ? "indexable" : "noindex",
        included_in_current_sitemap: entry.showInSitemap ? "yes" : "no",
        canonical_target: toAbsoluteUrl(entry.landing.canonicalPath),
        source: "dynamic_landings",
        entity_id: entry.landing.seoKey,
        entity_slug: entry.landing.seoKey,
        old_url: "",
        redirect_target: "",
        redirect_type: "",
        migration_status: "pending_legacy_mapping",
        priority: entry.isIndexable ? (entry.showInSitemap ? "high" : "medium") : "low",
        notes: [
          `landing_kind=${entry.landing.kind}`,
          `results=${entry.resultCount}`,
          `eligibility=${entry.status}`,
          `show_in_hub=${entry.showInHub ? "yes" : "no"}`,
        ].join(" "),
      });
    }
  }

  return rows;
}

function buildPostRows(posts: any[]) {
  const rows: CsvRow[] = [];

  for (const lang of SUPPORTED_LANGS) {
    for (const post of posts) {
      if (post.status !== "published") continue;
      const slug = typeof post.slugs?.[lang] === "string" ? post.slugs[lang].trim() : "";
      if (!slug) continue;

      const pathname = `/${lang}/post/${slug}/`;
      rows.push({
        new_url: toAbsoluteUrl(pathname),
        lang,
        url_type: "post_detail",
        index_status: "indexable",
        included_in_current_sitemap: "yes",
        canonical_target: toAbsoluteUrl(pathname),
        source: "posts_data",
        entity_id: String(post.id ?? ""),
        entity_slug: slug,
        old_url: "",
        redirect_target: "",
        redirect_type: "",
        migration_status: "pending_legacy_mapping",
        priority: "high",
        notes: `published_at=${String(post.published_at ?? "")} category=${String(post.category ?? "")}`,
      });
    }
  }

  return rows;
}

function buildAgentRows(teamMembers: any[]) {
  const rows: CsvRow[] = [];

  for (const lang of SUPPORTED_LANGS) {
    for (const member of teamMembers) {
      const slug = String(member.id ?? slugifyName(member.name ?? "")).trim();
      if (!slug) continue;

      const pathname = `/${lang}/agents/${slug}/`;
      rows.push({
        new_url: toAbsoluteUrl(pathname),
        lang,
        url_type: "agent_detail",
        index_status: "indexable",
        included_in_current_sitemap: "yes",
        canonical_target: toAbsoluteUrl(pathname),
        source: "team_data",
        entity_id: String(member.id ?? slug),
        entity_slug: slug,
        old_url: "",
        redirect_target: "",
        redirect_type: "",
        migration_status: "pending_legacy_mapping",
        priority: "medium",
        notes: `team_category=${String(member.category ?? "")}`,
      });
    }
  }

  return rows;
}

function buildFutureTemplateRows() {
  const rows: CsvRow[] = [];

  for (const lang of SUPPORTED_LANGS) {
    for (const template of futureTemplateTypes) {
      rows.push({
        new_url: toAbsoluteUrl(template.buildPath(lang)),
        lang,
        url_type: template.urlType,
        index_status: "excluded_public",
        included_in_current_sitemap: "no",
        canonical_target: "",
        source: "manual_future_template",
        entity_id: "",
        entity_slug: "__template__",
        old_url: "",
        redirect_target: "",
        redirect_type: "",
        migration_status: "template_pending",
        priority: "planned",
        notes: template.notes,
      });
    }
  }

  return rows;
}

function dedupeRows(rows: CsvRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.new_url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortRows(rows: CsvRow[]) {
  return [...rows].sort((left, right) => {
    const langDelta = left.lang.localeCompare(right.lang, undefined, { sensitivity: "base" });
    if (langDelta !== 0) return langDelta;
    return left.new_url.localeCompare(right.new_url, undefined, { sensitivity: "base" });
  });
}

async function main() {
  buildSitemapStaticLookup();

  const [posts, teamMembers, rawProperties] = await Promise.all([
    readJsonDirectory(path.join(REPO_ROOT, "src/data/posts")),
    readJsonDirectory(path.join(REPO_ROOT, "src/data/team")),
    readJsonDirectory(path.join(REPO_ROOT, "src/data/properties")),
  ]);

  const properties = rawProperties
    .map((property) => normalizePm0074PublicProperty(property))
    .sort((left, right) =>
      String(left.id ?? "").localeCompare(String(right.id ?? ""), undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );

  const rows = sortRows(
    dedupeRows([
      ...buildStaticRows(),
      ...buildPropertyRows(properties),
      ...buildLandingRows(properties),
      ...buildPostRows(posts),
      ...buildAgentRows(teamMembers),
      ...buildFutureTemplateRows(),
    ])
  );

  const csv = [
    csvHeaders.join(","),
    ...rows.map((row) => csvHeaders.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");

  await fs.writeFile(CSV_OUTPUT_PATH, csv, "utf8");

  const countsByType = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.url_type] = (acc[row.url_type] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`Generated ${rows.length} rows at ${path.relative(REPO_ROOT, CSV_OUTPUT_PATH)}`);
  console.log(JSON.stringify(countsByType, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
