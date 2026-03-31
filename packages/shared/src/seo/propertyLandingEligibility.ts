import {
  SEO_LANDING_CITIES,
  SEO_LANDING_RULES,
  SEO_LANDING_TYPES,
  type SeoLandingAreaConfig,
  type SeoLandingCityConfig,
  type SeoLandingPopularSearchConfig,
  type SeoLandingRuleConfig,
  type SeoLandingTypeConfig,
} from "@shared/config/seoSlugs";
import { applyFilters } from "@shared/properties/applyFilters";
import {
  resolvePropertyLanding,
  type PropertyLandingKind,
  type PropertyLandingModel,
} from "@shared/seo/resolvePropertyLanding";

type NormalizedCard = {
  visible: boolean;
  status?: string | null;
  parentId?: string | null;
  [key: string]: unknown;
};

type LandingPublicationConfig = {
  enabled: boolean;
  showInHub: boolean;
  showInSitemap: boolean;
  minHubResults: number;
};

export type SeoLandingEligibilityStatus = "keep" | "keep_nohub" | "remove";

export type PropertyLandingEligibility = {
  landing: PropertyLandingModel;
  resultCount: number;
  isIndexable: boolean;
  showInHub: boolean;
  showInSitemap: boolean;
  status: SeoLandingEligibilityStatus;
  score: number;
};

const defaultPublicationByKind: Record<PropertyLandingKind, LandingPublicationConfig> = {
  city: {
    enabled: true,
    showInHub: true,
    showInSitemap: true,
    minHubResults: 3,
  },
  "city-area": {
    enabled: true,
    showInHub: true,
    showInSitemap: true,
    minHubResults: 3,
  },
  "city-type": {
    enabled: true,
    showInHub: true,
    showInSitemap: true,
    minHubResults: 3,
  },
  "city-area-type": {
    enabled: true,
    showInHub: false,
    showInSitemap: false,
    minHubResults: 3,
  },
  "city-popular": {
    enabled: true,
    showInHub: false,
    showInSitemap: false,
    minHubResults: 3,
  },
};

const dedupeSlugSegments = (entries: string[][]) => {
  const seen = new Set<string>();
  return entries.filter((segments) => {
    const key = segments.join("/");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const mergePublicationConfig = (
  base: LandingPublicationConfig,
  ...sources: Array<
    | Pick<SeoLandingCityConfig, "enabled" | "showInHub" | "showInSitemap" | "minHubResults">
    | Pick<SeoLandingAreaConfig, "enabled" | "showInHub" | "showInSitemap" | "minHubResults">
    | Pick<SeoLandingTypeConfig, "enabled" | "showInHub" | "showInSitemap" | "minHubResults">
    | Pick<SeoLandingPopularSearchConfig, "enabled" | "showInHub" | "showInSitemap" | "minHubResults">
    | SeoLandingRuleConfig
    | null
    | undefined
  >
): LandingPublicationConfig =>
  sources.reduce(
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

const buildAllPropertyLandingSlugSegments = () =>
  dedupeSlugSegments(
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

const countVisibleResults = (cards: NormalizedCard[], landing: PropertyLandingModel) =>
  applyFilters(cards as any[], landing.queryFilters).length;

const cityBySlug = new Map(SEO_LANDING_CITIES.map((city) => [city.slug, city]));
const typeBySlug = new Map(SEO_LANDING_TYPES.map((type) => [type.slug, type]));
const allPropertyLandingsCache = new Map<string, PropertyLandingModel[]>();
const propertyLandingEligibilityCache = new WeakMap<
  object[],
  Map<string, PropertyLandingEligibility[]>
>();

const resolvePublicationConfig = (
  landing: PropertyLandingModel
): LandingPublicationConfig => {
  const cityConfig = cityBySlug.get(landing.city.slug);
  const areaConfig = cityConfig?.areas.find((area) => area.slug === landing.area?.slug);
  const typeConfig = landing.type ? typeBySlug.get(landing.type.slug) : null;
  const popularConfig = cityConfig?.popularSearches.find((popular) => popular.slug === landing.popular?.slug);
  const ruleConfig = SEO_LANDING_RULES[landing.seoKey];

  return mergePublicationConfig(
    defaultPublicationByKind[landing.kind],
    cityConfig,
    areaConfig,
    typeConfig,
    popularConfig,
    ruleConfig
  );
};

export function buildAllPropertyLandings(lang: string): PropertyLandingModel[] {
  const cached = allPropertyLandingsCache.get(lang);
  if (cached) {
    return cached;
  }

  const landings = buildAllPropertyLandingSlugSegments()
    .map((slugSegments) => resolvePropertyLanding({ lang, slugSegments }))
    .filter((landing): landing is PropertyLandingModel => Boolean(landing));
  allPropertyLandingsCache.set(lang, landings);
  return landings;
}

export function evaluatePropertyLandingEligibility({
  lang,
  cards,
}: {
  lang: string;
  cards: NormalizedCard[];
}): PropertyLandingEligibility[] {
  const cacheKey = cards as object[];
  const cachedByLang = propertyLandingEligibilityCache.get(cacheKey);
  const cachedEntries = cachedByLang?.get(lang);
  if (cachedEntries) {
    return cachedEntries;
  }

  const entries = buildAllPropertyLandings(lang).map((landing) => {
    const publication = resolvePublicationConfig(landing);
    const resultCount = countVisibleResults(cards, landing);
    const isIndexable = publication.enabled && landing.indexable && resultCount >= landing.minResults;
    const showInHub = isIndexable && publication.showInHub && resultCount >= publication.minHubResults;
    const showInSitemap = isIndexable && publication.showInSitemap;
    const status: SeoLandingEligibilityStatus =
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
      score: landing.demandScore * 100 + Math.min(resultCount, 99),
    };
  });

  const nextCache = cachedByLang ?? new Map<string, PropertyLandingEligibility[]>();
  nextCache.set(lang, entries);
  propertyLandingEligibilityCache.set(cacheKey, nextCache);

  return entries;
}

export function buildPropertyLandingEligibilityMap(entries: PropertyLandingEligibility[]) {
  return new Map(entries.map((entry) => [entry.landing.seoKey, entry]));
}
