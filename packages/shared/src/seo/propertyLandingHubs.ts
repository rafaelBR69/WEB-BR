import {
  SEO_LANDING_CITIES,
  SEO_LANDING_TYPES,
} from "@shared/config/seoSlugs";
import { CITIES, TYPES } from "@shared/data/properties/taxonomies";
import type { PropertyLandingModel } from "@shared/seo/resolvePropertyLanding";
import { displayLocation } from "@shared/presentation/common";

type HubLink = {
  href: string;
  label: string;
  score?: number;
};

type HubSection = {
  title: string;
  links: HubLink[];
};

const copyByLang = {
  es: {
    cities: "Ciudades destacadas",
    areas: "Zonas destacadas",
    types: "Busquedas por tipo",
    areaTypes: "Busquedas por zona y tipo",
    popular: "Busquedas populares",
    related: "Explorar mas en esta zona",
  },
  en: {
    cities: "Featured cities",
    areas: "Featured areas",
    types: "Search by property type",
    areaTypes: "Area and type searches",
    popular: "Popular searches",
    related: "Explore more in this market",
  },
};

const SIGNAL_SCORES: Record<string, number> = {
  "mijas": 100,
  "marbella": 96,
  "mijas/la-cala": 94,
  "marbella/puerto-banus": 92,
  "mijas/villas": 90,
  "mijas/la-cala/apartments": 88,
  "mijas/search/sea-view": 84,
  "marbella/search/new-build": 82,
};

const POPULAR_LABELS = {
  sea_view: {
    es: "Vistas al mar",
    en: "Sea view",
  },
  new_build: {
    es: "Obra nueva",
    en: "New build",
  },
  pool: {
    es: "Piscina",
    en: "Pool",
  },
  gated_community: {
    es: "Urbanizacion cerrada",
    en: "Gated community",
  },
};

const getCopy = (lang: string) => copyByLang[lang as keyof typeof copyByLang] ?? copyByLang.es;

const getCityLabel = (key: string, lang: string) =>
  CITIES[key]?.label?.[lang] ?? CITIES[key]?.label?.es ?? displayLocation(key);

const getTypeLabel = (key: string, lang: string) =>
  TYPES[key]?.label?.[lang] ?? TYPES[key]?.label?.es ?? displayLocation(key);

const getPopularLabel = (key: string, lang: string) =>
  POPULAR_LABELS[key as keyof typeof POPULAR_LABELS]?.[
    lang as keyof (typeof POPULAR_LABELS)[keyof typeof POPULAR_LABELS]
  ] ??
  POPULAR_LABELS[key as keyof typeof POPULAR_LABELS]?.es ??
  displayLocation(key);

const sortLinks = (links: HubLink[]) =>
  links
    .slice()
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.label.localeCompare(right.label))
    .map(({ score: _score, ...rest }) => rest);

export function buildPropertyLandingHubs({
  lang,
  landing = null,
}: {
  lang: string;
  landing?: PropertyLandingModel | null;
}): HubSection[] {
  const copy = getCopy(lang);

  if (!landing) {
    return [
      {
        title: copy.cities,
        links: sortLinks(
          SEO_LANDING_CITIES.map((city) => ({
            href: `/${lang}/properties/${city.slug}/`,
            label: getCityLabel(city.cityKey, lang),
            score: SIGNAL_SCORES[city.slug] ?? city.priority ?? 0,
          }))
        ),
      },
      {
        title: copy.areas,
        links: sortLinks(
          SEO_LANDING_CITIES.flatMap((city) =>
            city.areas.map((area) => ({
              href: `/${lang}/properties/${city.slug}/${area.slug}/`,
              label: getCityLabel(area.areaKey, lang),
              score: SIGNAL_SCORES[`${city.slug}/${area.slug}`] ?? area.priority ?? 0,
            }))
          )
        ),
      },
      {
        title: copy.types,
        links: sortLinks(
          SEO_LANDING_CITIES.flatMap((city) =>
            city.typeSlugs.map((typeSlug) => {
              const typeConfig = SEO_LANDING_TYPES.find((type) => type.slug === typeSlug);
              return {
                href: `/${lang}/properties/${city.slug}/${typeSlug}/`,
                label: `${getTypeLabel(typeConfig?.typeKey ?? typeSlug, lang)} ${getCityLabel(city.cityKey, lang)}`,
                score: SIGNAL_SCORES[`${city.slug}/${typeSlug}`] ?? typeConfig?.priority ?? 0,
              };
            })
          )
        ),
      },
      {
        title: copy.areaTypes,
        links: sortLinks(
          SEO_LANDING_CITIES.flatMap((city) =>
            city.areas.flatMap((area) =>
              (area.typeSlugs && area.typeSlugs.length ? area.typeSlugs : city.typeSlugs).map((typeSlug) => {
                const typeConfig = SEO_LANDING_TYPES.find((type) => type.slug === typeSlug);
                return {
                  href: `/${lang}/properties/${city.slug}/${area.slug}/${typeSlug}/`,
                  label: `${getTypeLabel(typeConfig?.typeKey ?? typeSlug, lang)} ${getCityLabel(area.areaKey, lang)}`,
                  score: SIGNAL_SCORES[`${city.slug}/${area.slug}/${typeSlug}`] ?? Math.max(area.priority ?? 0, typeConfig?.priority ?? 0),
                };
              })
            )
          )
        ).slice(0, 12),
      },
      {
        title: copy.popular,
        links: sortLinks(
          SEO_LANDING_CITIES.flatMap((city) =>
            city.popularSearches.map((popular) => ({
              href: `/${lang}/properties/${city.slug}/search/${popular.slug}/`,
              label: `${getPopularLabel(popular.labelKey, lang)} ${getCityLabel(city.cityKey, lang)}`,
              score: SIGNAL_SCORES[`${city.slug}/search/${popular.slug}`] ?? popular.priority ?? 0,
            }))
          )
        ),
      },
    ];
  }

  const cityConfig = SEO_LANDING_CITIES.find((city) => city.slug === landing.city.slug);
  if (!cityConfig) {
    return [];
  }

  const relatedLinks: HubLink[] = [
    ...cityConfig.areas
      .filter((area) => area.slug !== landing.area?.slug)
      .map((area) => ({
        href: `/${lang}/properties/${cityConfig.slug}/${area.slug}/`,
        label: getCityLabel(area.areaKey, lang),
        score: SIGNAL_SCORES[`${cityConfig.slug}/${area.slug}`] ?? area.priority ?? 0,
      })),
    ...cityConfig.typeSlugs
      .filter((typeSlug) => typeSlug !== landing.type?.slug)
      .map((typeSlug) => {
        const typeConfig = SEO_LANDING_TYPES.find((type) => type.slug === typeSlug);
        return {
          href: `/${lang}/properties/${cityConfig.slug}/${typeSlug}/`,
          label: getTypeLabel(typeConfig?.typeKey ?? typeSlug, lang),
          score: SIGNAL_SCORES[`${cityConfig.slug}/${typeSlug}`] ?? typeConfig?.priority ?? 0,
        };
      }),
    ...cityConfig.popularSearches
      .filter((popular) => popular.slug !== landing.popular?.slug)
      .map((popular) => ({
        href: `/${lang}/properties/${cityConfig.slug}/search/${popular.slug}/`,
        label: getPopularLabel(popular.labelKey, lang),
        score: SIGNAL_SCORES[`${cityConfig.slug}/search/${popular.slug}`] ?? popular.priority ?? 0,
      })),
  ];

  if (landing.area) {
    const areaConfig = cityConfig.areas.find((area) => area.slug === landing.area?.slug);
    if (areaConfig) {
      const typeSlugs =
        areaConfig.typeSlugs && areaConfig.typeSlugs.length
          ? areaConfig.typeSlugs
          : cityConfig.typeSlugs;

      relatedLinks.push(
        ...typeSlugs
          .filter((typeSlug) => typeSlug !== landing.type?.slug)
          .map((typeSlug) => {
            const typeConfig = SEO_LANDING_TYPES.find((type) => type.slug === typeSlug);
            return {
              href: `/${lang}/properties/${cityConfig.slug}/${areaConfig.slug}/${typeSlug}/`,
              label: `${getTypeLabel(typeConfig?.typeKey ?? typeSlug, lang)} ${getCityLabel(areaConfig.areaKey, lang)}`,
              score: SIGNAL_SCORES[`${cityConfig.slug}/${areaConfig.slug}/${typeSlug}`] ?? Math.max(areaConfig.priority ?? 0, typeConfig?.priority ?? 0),
            };
          })
      );
    }
  }

  return [
    {
      title: copy.related,
      links: sortLinks(relatedLinks).slice(0, 12),
    },
  ].filter((section) => section.links.length > 0);
}
