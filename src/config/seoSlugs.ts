export type SeoLandingAreaConfig = {
  slug: string;
  areaKey: string;
  priority?: number;
  minResults?: number;
  typeSlugs?: string[];
};

export type SeoLandingTypeConfig = {
  slug: string;
  typeKey: string;
  priority?: number;
  minResults?: number;
};

export type SeoLandingPopularSearchConfig = {
  slug: string;
  labelKey: string;
  featureKey?: string;
  marketKey?: string;
  priority?: number;
  minResults?: number;
};

export type SeoLandingCityConfig = {
  slug: string;
  cityKey: string;
  priority?: number;
  minResults?: number;
  areas: SeoLandingAreaConfig[];
  typeSlugs: string[];
  popularSearches: SeoLandingPopularSearchConfig[];
};

export const SEO_LANDING_TYPES: SeoLandingTypeConfig[] = [
  {
    slug: "villas",
    typeKey: "villas",
    priority: 100,
    minResults: 3,
  },
  {
    slug: "apartments",
    typeKey: "pisos",
    priority: 90,
    minResults: 3,
  },
];

const DEFAULT_POPULAR_SEARCHES: SeoLandingPopularSearchConfig[] = [
  {
    slug: "sea-view",
    labelKey: "sea_view",
    featureKey: "sea_views",
    priority: 100,
    minResults: 3,
  },
  {
    slug: "new-build",
    labelKey: "new_build",
    marketKey: "obra_nueva",
    priority: 95,
    minResults: 3,
  },
  {
    slug: "pool",
    labelKey: "pool",
    featureKey: "communal_pool",
    priority: 90,
    minResults: 3,
  },
  {
    slug: "gated-community",
    labelKey: "gated_community",
    featureKey: "gated_community",
    priority: 85,
    minResults: 3,
  },
];

export const SEO_LANDING_CITIES: SeoLandingCityConfig[] = [
  {
    slug: "mijas",
    cityKey: "mijas",
    priority: 100,
    minResults: 3,
    typeSlugs: ["villas", "apartments"],
    popularSearches: DEFAULT_POPULAR_SEARCHES,
    areas: [
      {
        slug: "la-cala",
        areaKey: "la_cala_de_mijas",
        priority: 100,
        minResults: 3,
        typeSlugs: ["apartments", "villas"],
      },
      {
        slug: "calahonda",
        areaKey: "calahonda",
        priority: 80,
        minResults: 3,
        typeSlugs: ["apartments", "villas"],
      },
    ],
  },
  {
    slug: "marbella",
    cityKey: "marbella",
    priority: 95,
    minResults: 3,
    typeSlugs: ["villas", "apartments"],
    popularSearches: DEFAULT_POPULAR_SEARCHES,
    areas: [
      {
        slug: "puerto-banus",
        areaKey: "puerto_banus",
        priority: 100,
        minResults: 3,
        typeSlugs: ["apartments", "villas"],
      },
      {
        slug: "nueva-andalucia",
        areaKey: "nueva_andalucia",
        priority: 90,
        minResults: 3,
        typeSlugs: ["villas", "apartments"],
      },
    ],
  },
  {
    slug: "fuengirola",
    cityKey: "fuengirola",
    priority: 85,
    minResults: 3,
    typeSlugs: ["apartments", "villas"],
    popularSearches: DEFAULT_POPULAR_SEARCHES,
    areas: [
      {
        slug: "los-boliches",
        areaKey: "los_boliches",
        priority: 90,
        minResults: 3,
        typeSlugs: ["apartments"],
      },
    ],
  },
];

export const INDEXABLE_CITIES = SEO_LANDING_CITIES.map((city) => city.slug);

export const INDEXABLE_AREAS: Record<string, string[]> = Object.fromEntries(
  SEO_LANDING_CITIES.map((city) => [
    city.slug,
    city.areas.map((area) => area.slug),
  ])
);

export const INDEXABLE_TYPES = SEO_LANDING_TYPES.map((type) => type.slug);
