export type SeoLandingAreaConfig = {
  slug: string;
  areaKey: string;
  aliases?: string[];
  priority?: number;
  minResults?: number;
  typeSlugs?: string[];
  enabled?: boolean;
  showInHub?: boolean;
  showInSitemap?: boolean;
  minHubResults?: number;
};

export type SeoLandingTypeConfig = {
  slug: string;
  typeKey: string;
  aliases?: string[];
  priority?: number;
  minResults?: number;
  enabled?: boolean;
  showInHub?: boolean;
  showInSitemap?: boolean;
  minHubResults?: number;
};

export type SeoLandingPopularSearchConfig = {
  slug: string;
  labelKey: string;
  featureKey?: string;
  marketKey?: string;
  typeKey?: string;
  priceMin?: number;
  priority?: number;
  minResults?: number;
  enabled?: boolean;
  showInHub?: boolean;
  showInSitemap?: boolean;
  minHubResults?: number;
};

export type SeoLandingCityConfig = {
  slug: string;
  cityKey: string;
  priority?: number;
  minResults?: number;
  enabled?: boolean;
  showInHub?: boolean;
  showInSitemap?: boolean;
  minHubResults?: number;
  areas: SeoLandingAreaConfig[];
  typeSlugs: string[];
  popularSearches: SeoLandingPopularSearchConfig[];
};

export type SeoLandingRuleConfig = {
  enabled?: boolean;
  showInHub?: boolean;
  showInSitemap?: boolean;
  minHubResults?: number;
  minResults?: number;
  priority?: number;
};

export const SEO_LANDING_TYPES: SeoLandingTypeConfig[] = [
  {
    slug: "villas",
    typeKey: "villas",
    priority: 100,
    minResults: 3,
    showInHub: true,
    showInSitemap: true,
  },
  {
    slug: "pisos",
    typeKey: "pisos",
    aliases: ["apartments", "apartamentos"],
    priority: 90,
    minResults: 3,
    showInHub: true,
    showInSitemap: true,
  },
  {
    slug: "casas",
    typeKey: "adosadas",
    aliases: ["townhouses", "adosadas"],
    priority: 82,
    minResults: 3,
    showInHub: true,
    showInSitemap: true,
  },
];

const DEFAULT_POPULAR_SEARCHES: SeoLandingPopularSearchConfig[] = [
  {
    slug: "sea-view",
    labelKey: "sea_view",
    featureKey: "sea_views",
    priority: 100,
    minResults: 3,
    showInHub: false,
    showInSitemap: false,
  },
  {
    slug: "new-build",
    labelKey: "new_build",
    marketKey: "obra_nueva",
    priority: 95,
    minResults: 3,
    showInHub: false,
    showInSitemap: false,
  },
  {
    slug: "pool",
    labelKey: "pool",
    featureKey: "communal_pool",
    priority: 90,
    minResults: 3,
    showInHub: false,
    showInSitemap: false,
  },
  {
    slug: "gated-community",
    labelKey: "gated_community",
    featureKey: "gated_community",
    priority: 85,
    minResults: 3,
    showInHub: false,
    showInSitemap: false,
  },
  {
    slug: "villas-de-lujo",
    labelKey: "luxury_villas",
    typeKey: "villas",
    priceMin: 1000000,
    priority: 92,
    minResults: 2,
    showInHub: false,
    showInSitemap: false,
  },
];

export const SEO_LANDING_CITIES: SeoLandingCityConfig[] = [
  {
    slug: "mijas",
    cityKey: "mijas",
    priority: 100,
    minResults: 3,
    showInHub: true,
    showInSitemap: true,
    typeSlugs: ["villas", "pisos", "casas"],
    popularSearches: DEFAULT_POPULAR_SEARCHES,
    areas: [
      {
        slug: "la-cala",
        areaKey: "la_cala_de_mijas",
        aliases: ["la-cala-de-mijas"],
        priority: 100,
        minResults: 3,
        typeSlugs: ["pisos", "villas", "casas"],
        showInHub: true,
        showInSitemap: true,
      },
      {
        slug: "calahonda",
        areaKey: "calahonda",
        priority: 80,
        minResults: 3,
        typeSlugs: ["pisos", "villas"],
        showInHub: true,
        showInSitemap: true,
      },
      {
        slug: "las-lagunas",
        areaKey: "las_lagunas_de_mijas",
        aliases: ["las-lagunas-de-mijas"],
        priority: 76,
        minResults: 2,
        typeSlugs: ["pisos", "casas"],
        showInHub: true,
        showInSitemap: true,
      },
    ],
  },
  {
    slug: "marbella",
    cityKey: "marbella",
    priority: 95,
    minResults: 3,
    showInHub: true,
    showInSitemap: true,
    typeSlugs: ["villas", "pisos", "casas"],
    popularSearches: DEFAULT_POPULAR_SEARCHES,
    areas: [
      {
        slug: "puerto-banus",
        areaKey: "puerto_banus",
        priority: 100,
        minResults: 3,
        typeSlugs: ["pisos", "villas"],
        showInHub: true,
        showInSitemap: true,
      },
      {
        slug: "nueva-andalucia",
        areaKey: "nueva_andalucia",
        priority: 90,
        minResults: 3,
        typeSlugs: ["villas", "pisos", "casas"],
        showInHub: true,
        showInSitemap: true,
      },
    ],
  },
  {
    slug: "estepona",
    cityKey: "estepona",
    priority: 90,
    minResults: 2,
    showInHub: true,
    showInSitemap: true,
    typeSlugs: ["villas", "pisos"],
    popularSearches: [
      DEFAULT_POPULAR_SEARCHES[1],
      DEFAULT_POPULAR_SEARCHES[0],
      DEFAULT_POPULAR_SEARCHES[4],
    ],
    areas: [],
  },
  {
    slug: "fuengirola",
    cityKey: "fuengirola",
    priority: 85,
    minResults: 3,
    showInHub: true,
    showInSitemap: true,
    typeSlugs: ["pisos", "villas", "casas"],
    popularSearches: DEFAULT_POPULAR_SEARCHES,
    areas: [
      {
        slug: "los-boliches",
        areaKey: "los_boliches",
        priority: 90,
        minResults: 3,
        typeSlugs: ["pisos"],
        showInHub: true,
        showInSitemap: true,
      },
      {
        slug: "torreblanca",
        areaKey: "torreblanca",
        aliases: ["torreblanca-fuengirola"],
        priority: 88,
        minResults: 2,
        typeSlugs: ["villas", "pisos"],
        showInHub: true,
        showInSitemap: true,
      },
    ],
  },
  {
    slug: "manilva",
    cityKey: "manilva",
    priority: 82,
    minResults: 2,
    showInHub: true,
    showInSitemap: true,
    typeSlugs: ["pisos", "villas"],
    popularSearches: [
      DEFAULT_POPULAR_SEARCHES[1],
      DEFAULT_POPULAR_SEARCHES[0],
      DEFAULT_POPULAR_SEARCHES[4],
    ],
    areas: [],
  },
];

export const SEO_LANDING_RULES: Record<string, SeoLandingRuleConfig> = {
  "estepona/villas": {
    showInHub: true,
    showInSitemap: true,
  },
  "estepona/pisos": {
    showInHub: true,
    showInSitemap: true,
  },
  "estepona/search/new-build": {
    showInHub: true,
    showInSitemap: true,
  },
  "mijas/villas": {
    showInHub: true,
    showInSitemap: true,
  },
  "mijas/pisos": {
    showInHub: true,
    showInSitemap: true,
  },
  "mijas/casas": {
    showInHub: true,
    showInSitemap: true,
  },
  "marbella/villas": {
    showInHub: true,
    showInSitemap: true,
  },
  "marbella/pisos": {
    showInHub: true,
    showInSitemap: true,
  },
  "marbella/casas": {
    showInHub: true,
    showInSitemap: true,
  },
  "fuengirola/pisos": {
    showInHub: true,
    showInSitemap: true,
  },
  "fuengirola/villas": {
    showInHub: true,
    showInSitemap: true,
  },
  "fuengirola/casas": {
    showInHub: true,
    showInSitemap: true,
  },
  "manilva/pisos": {
    showInHub: true,
    showInSitemap: true,
  },
  "manilva/search/new-build": {
    showInHub: true,
    showInSitemap: true,
  },
  "mijas/la-cala/pisos": {
    showInHub: true,
    showInSitemap: true,
  },
  "mijas/la-cala/villas": {
    showInHub: true,
    showInSitemap: true,
  },
  "mijas/calahonda/pisos": {
    showInHub: true,
    showInSitemap: true,
  },
  "mijas/las-lagunas": {
    showInHub: true,
    showInSitemap: true,
  },
  "mijas/las-lagunas/pisos": {
    showInHub: true,
    showInSitemap: true,
  },
  "marbella/puerto-banus/pisos": {
    showInHub: true,
    showInSitemap: true,
  },
  "marbella/puerto-banus/villas": {
    showInHub: true,
    showInSitemap: true,
  },
  "marbella/nueva-andalucia/villas": {
    showInHub: true,
    showInSitemap: true,
  },
  "marbella/nueva-andalucia/pisos": {
    showInHub: true,
    showInSitemap: true,
  },
  "fuengirola/torreblanca": {
    showInHub: true,
    showInSitemap: true,
  },
  "fuengirola/torreblanca/villas": {
    showInHub: true,
    showInSitemap: true,
  },
  "fuengirola/torreblanca/pisos": {
    showInHub: true,
    showInSitemap: true,
  },
  "mijas/search/sea-view": {
    showInHub: true,
    showInSitemap: true,
  },
  "marbella/search/new-build": {
    showInHub: true,
    showInSitemap: true,
  },
  "mijas/search/villas-de-lujo": {
    showInHub: false,
    showInSitemap: true,
  },
  "marbella/search/villas-de-lujo": {
    showInHub: false,
    showInSitemap: true,
  },
  "fuengirola/search/villas-de-lujo": {
    showInHub: false,
    showInSitemap: true,
  },
  "manilva/search/villas-de-lujo": {
    showInHub: false,
    showInSitemap: true,
  },
};

export const INDEXABLE_CITIES = SEO_LANDING_CITIES.map((city) => city.slug);

export const INDEXABLE_AREAS: Record<string, string[]> = Object.fromEntries(
  SEO_LANDING_CITIES.map((city) => [
    city.slug,
    city.areas.map((area) => area.slug),
  ])
);

export const INDEXABLE_TYPES = SEO_LANDING_TYPES.map((type) => type.slug);
