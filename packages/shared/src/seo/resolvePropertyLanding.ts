import {
  SEO_LANDING_CITIES,
  SEO_LANDING_RULES,
  SEO_LANDING_TYPES,
  type SeoLandingAreaConfig,
  type SeoLandingCityConfig,
  type SeoLandingPopularSearchConfig,
  type SeoLandingTypeConfig,
} from "@shared/config/seoSlugs";
import { CITIES, TYPES } from "@shared/data/properties/taxonomies";
import { displayLocation } from "@shared/presentation/common";

export type PropertyLandingKind =
  | "city"
  | "city-area"
  | "city-type"
  | "city-area-type"
  | "city-popular";

export type PropertyLandingEntity = {
  slug: string;
  key: string;
  label: string;
};

export type PropertyLandingModel = {
  kind: PropertyLandingKind;
  seoKey: string;
  slugSegments: string[];
  canonicalPath: string;
  indexable: boolean;
  minResults: number;
  city: PropertyLandingEntity;
  area: PropertyLandingEntity | null;
  type: PropertyLandingEntity | null;
  popular: PropertyLandingEntity | null;
  demandScore: number;
  queryFilters: {
    city: string[] | null;
    area: string[] | null;
    type: string[] | null;
    market: string | null;
    feature: string[] | null;
    priceMin: number | null;
  };
};

const DEFAULT_MIN_RESULTS = 3;

const LANDING_SIGNAL_SCORES: Record<string, number> = {
  "mijas": 100,
  "marbella": 96,
  "fuengirola": 88,
  "mijas/la-cala": 94,
  "marbella/puerto-banus": 92,
  "mijas/villas": 90,
  "marbella/pisos": 86,
  "mijas/pisos": 89,
  "mijas/casas": 78,
  "mijas/calahonda": 84,
  "fuengirola/torreblanca": 83,
  "manilva": 80,
  "mijas/search/sea-view": 84,
  "marbella/search/new-build": 82,
  "fuengirola/search/pool": 78,
};

const POPULAR_LABELS = {
  sea_view: {
    es: "Vistas al mar",
    en: "Sea view",
    de: "Meerblick",
    fr: "Vue mer",
    it: "Vista mare",
    nl: "Zeezicht",
  },
  new_build: {
    es: "Obra nueva",
    en: "New build",
    de: "Neubau",
    fr: "Neuf",
    it: "Nuova costruzione",
    nl: "Nieuwbouw",
  },
  pool: {
    es: "Piscina",
    en: "Pool",
    de: "Pool",
    fr: "Piscine",
    it: "Piscina",
    nl: "Zwembad",
  },
  gated_community: {
    es: "Urbanizacion cerrada",
    en: "Gated community",
    de: "Geschlossene Wohnanlage",
    fr: "Residence fermee",
    it: "Complesso chiuso",
    nl: "Afgesloten wooncomplex",
  },
  luxury_villas: {
    es: "Villas de lujo",
    en: "Luxury villas",
    de: "Luxusvillen",
    fr: "Villas de luxe",
    it: "Ville di lusso",
    nl: "Luxe villa's",
  },
} as const;

const normalizeSlug = (value: string) =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "");

const matchesSlug = (
  value: string,
  config: {
    slug: string;
    aliases?: string[];
  }
) => value === config.slug || Boolean(config.aliases?.includes(value));

const getLocationLabel = (key: string, lang: string) =>
  CITIES[key]?.label?.[lang] ??
  CITIES[key]?.label?.es ??
  displayLocation(key);

const getTypeLabel = (key: string, lang: string) =>
  TYPES[key]?.label?.[lang] ??
  TYPES[key]?.label?.es ??
  displayLocation(key);

const getPopularLabel = (labelKey: string, lang: string) =>
  POPULAR_LABELS[labelKey as keyof typeof POPULAR_LABELS]?.[
    lang as keyof (typeof POPULAR_LABELS)[keyof typeof POPULAR_LABELS]
  ] ??
  POPULAR_LABELS[labelKey as keyof typeof POPULAR_LABELS]?.es ??
  displayLocation(labelKey);

const toCityEntity = (city: SeoLandingCityConfig, lang: string): PropertyLandingEntity => ({
  slug: city.slug,
  key: city.cityKey,
  label: getLocationLabel(city.cityKey, lang),
});

const toAreaEntity = (area: SeoLandingAreaConfig, lang: string): PropertyLandingEntity => ({
  slug: area.slug,
  key: area.areaKey,
  label: getLocationLabel(area.areaKey, lang),
});

const toTypeEntity = (type: SeoLandingTypeConfig, lang: string): PropertyLandingEntity => ({
  slug: type.slug,
  key: type.typeKey,
  label: getTypeLabel(type.typeKey, lang),
});

const toPopularEntity = (
  popular: SeoLandingPopularSearchConfig,
  lang: string
): PropertyLandingEntity => ({
  slug: popular.slug,
  key: popular.labelKey,
  label: getPopularLabel(popular.labelKey, lang),
});

const getDemandScore = (seoKey: string, configuredPriority = 0) =>
  SEO_LANDING_RULES[seoKey]?.priority ??
  LANDING_SIGNAL_SCORES[seoKey] ??
  configuredPriority;

const buildLandingModel = ({
  kind,
  lang,
  city,
  area = null,
  type = null,
  popular = null,
  minResults,
  queryFilters,
  slugSegments,
  configuredPriority = 0,
}: {
  kind: PropertyLandingKind;
  lang: string;
  city: PropertyLandingEntity;
  area?: PropertyLandingEntity | null;
  type?: PropertyLandingEntity | null;
  popular?: PropertyLandingEntity | null;
  minResults: number;
  queryFilters: PropertyLandingModel["queryFilters"];
  slugSegments: string[];
  configuredPriority?: number;
}): PropertyLandingModel => {
  const canonicalPath = `/${lang}/properties/${slugSegments.join("/")}/`;
  const seoKey = slugSegments.join("/");
  const ruleConfig = SEO_LANDING_RULES[seoKey];

  return {
    kind,
    seoKey,
    slugSegments,
    canonicalPath,
    indexable: ruleConfig?.enabled !== false,
    minResults: ruleConfig?.minResults ?? minResults,
    city,
    area,
    type,
    popular,
    demandScore: getDemandScore(seoKey, configuredPriority),
    queryFilters,
  };
};

export function resolvePropertyLanding({
  lang,
  slugSegments,
}: {
  lang: string;
  slugSegments: string[];
}): PropertyLandingModel | null {
  const segments = Array.isArray(slugSegments)
    ? slugSegments.map(normalizeSlug).filter(Boolean)
    : [];

  if (segments.length === 0 || segments.length > 3) {
    return null;
  }

  const cityConfig = SEO_LANDING_CITIES.find((city) => city.slug === segments[0]);
  if (!cityConfig) {
    return null;
  }

  const city = toCityEntity(cityConfig, lang);

  if (segments.length === 1) {
    return buildLandingModel({
      kind: "city",
      lang,
      city,
      minResults: cityConfig.minResults ?? DEFAULT_MIN_RESULTS,
      slugSegments: [city.slug],
      configuredPriority: cityConfig.priority ?? 0,
      queryFilters: {
        city: [city.key],
        area: null,
        type: null,
        market: null,
        feature: null,
        priceMin: null,
      },
    });
  }

  const secondSegment = segments[1];
  const areaConfig = cityConfig.areas.find((areaItem) => matchesSlug(secondSegment, areaItem));
  const typeConfig = SEO_LANDING_TYPES.find(
    (typeItem) => matchesSlug(secondSegment, typeItem) && cityConfig.typeSlugs.includes(typeItem.slug)
  );

  if (segments.length === 2 && areaConfig) {
    const area = toAreaEntity(areaConfig, lang);
    return buildLandingModel({
      kind: "city-area",
      lang,
      city,
      area,
      minResults: areaConfig.minResults ?? cityConfig.minResults ?? DEFAULT_MIN_RESULTS,
      slugSegments: [city.slug, area.slug],
      configuredPriority: areaConfig.priority ?? cityConfig.priority ?? 0,
      queryFilters: {
        city: [city.key],
        area: [area.key],
        type: null,
        market: null,
        feature: null,
        priceMin: null,
      },
    });
  }

  if (segments.length === 2 && typeConfig) {
    const type = toTypeEntity(typeConfig, lang);
    return buildLandingModel({
      kind: "city-type",
      lang,
      city,
      type,
      minResults: typeConfig.minResults ?? cityConfig.minResults ?? DEFAULT_MIN_RESULTS,
      slugSegments: [city.slug, type.slug],
      configuredPriority: typeConfig.priority ?? cityConfig.priority ?? 0,
      queryFilters: {
        city: [city.key],
        area: null,
        type: [type.key],
        market: null,
        feature: null,
        priceMin: null,
      },
    });
  }

  if (segments.length === 3 && secondSegment === "search") {
    const popularConfig = cityConfig.popularSearches.find((item) => item.slug === segments[2]);
    if (!popularConfig) {
      return null;
    }

    const popular = toPopularEntity(popularConfig, lang);
    return buildLandingModel({
      kind: "city-popular",
      lang,
      city,
      popular,
      minResults:
        popularConfig.minResults ?? cityConfig.minResults ?? DEFAULT_MIN_RESULTS,
      slugSegments: [city.slug, "search", popular.slug],
      configuredPriority: popularConfig.priority ?? cityConfig.priority ?? 0,
      queryFilters: {
        city: [city.key],
        area: null,
        type: popularConfig.typeKey ? [popularConfig.typeKey] : null,
        market: popularConfig.marketKey ?? null,
        feature: popularConfig.featureKey ? [popularConfig.featureKey] : null,
        priceMin: popularConfig.priceMin ?? null,
      },
    });
  }

  if (segments.length === 3 && areaConfig) {
    const thirdSegment = segments[2];
    const areaTypeSlugs =
      areaConfig.typeSlugs && areaConfig.typeSlugs.length
        ? areaConfig.typeSlugs
        : cityConfig.typeSlugs;
    const nestedTypeConfig = SEO_LANDING_TYPES.find(
      (typeItem) => matchesSlug(thirdSegment, typeItem) && areaTypeSlugs.includes(typeItem.slug)
    );

    if (!nestedTypeConfig) {
      return null;
    }

    const area = toAreaEntity(areaConfig, lang);
    const type = toTypeEntity(nestedTypeConfig, lang);

    return buildLandingModel({
      kind: "city-area-type",
      lang,
      city,
      area,
      type,
      minResults:
        nestedTypeConfig.minResults ??
        areaConfig.minResults ??
        cityConfig.minResults ??
        DEFAULT_MIN_RESULTS,
      slugSegments: [city.slug, area.slug, type.slug],
      configuredPriority:
        Math.max(areaConfig.priority ?? 0, nestedTypeConfig.priority ?? 0) ||
        (cityConfig.priority ?? 0),
      queryFilters: {
        city: [city.key],
        area: [area.key],
        type: [type.key],
        market: null,
        feature: null,
        priceMin: null,
      },
    });
  }

  return null;
}

export function buildPropertyLandingCatalogUrl(landing: PropertyLandingModel) {
  const searchParams = new URLSearchParams();

  landing.queryFilters.city?.forEach((city) => searchParams.append("city", city));
  landing.queryFilters.area?.forEach((area) => searchParams.append("area", area));
  landing.queryFilters.type?.forEach((type) => searchParams.append("type", type));
  landing.queryFilters.feature?.forEach((feature) => searchParams.append("feature", feature));
  if (landing.queryFilters.market) {
    searchParams.set("market", landing.queryFilters.market);
  }
  if (typeof landing.queryFilters.priceMin === "number") {
    searchParams.set("priceMin", String(landing.queryFilters.priceMin));
  }

  const query = searchParams.toString();
  const propertiesRoot = landing.canonicalPath.replace(/\/properties\/.*$/, "/properties/");
  return query ? `${propertiesRoot}?${query}` : propertiesRoot;
}

export function getPropertyLandingConfig() {
  return {
    cities: SEO_LANDING_CITIES,
    types: SEO_LANDING_TYPES,
    signals: LANDING_SIGNAL_SCORES,
  };
}
