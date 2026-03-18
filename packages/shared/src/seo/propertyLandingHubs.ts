import type { PropertyLandingEligibility } from "@shared/seo/propertyLandingEligibility";
import type { PropertyLandingModel } from "@shared/seo/resolvePropertyLanding";

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

const getCopy = (lang: string) => copyByLang[lang as keyof typeof copyByLang] ?? copyByLang.es;

const sortLinks = (links: HubLink[]) =>
  links
    .slice()
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.label.localeCompare(right.label))
    .map(({ score: _score, ...rest }) => rest);

const toHubLink = (entry: PropertyLandingEligibility): HubLink => {
  const { landing } = entry;
  const label =
    landing.kind === "city"
      ? landing.city.label
      : landing.kind === "city-area"
        ? landing.area?.label ?? landing.city.label
        : landing.kind === "city-type"
          ? `${landing.type?.label ?? ""} ${landing.city.label}`.trim()
          : landing.kind === "city-area-type"
            ? `${landing.type?.label ?? ""} ${landing.area?.label ?? landing.city.label}`.trim()
            : `${landing.popular?.label ?? ""} ${landing.city.label}`.trim();

  return {
    href: landing.canonicalPath,
    label,
    score: entry.score,
  };
};

export function buildPropertyLandingHubs({
  lang,
  eligibleLandings,
  landing = null,
}: {
  lang: string;
  eligibleLandings: PropertyLandingEligibility[];
  landing?: PropertyLandingModel | null;
}): HubSection[] {
  const copy = getCopy(lang);
  const curatedLandings = eligibleLandings.filter((entry) => entry.showInHub);

  if (!landing) {
    return [
      {
        title: copy.cities,
        links: sortLinks(curatedLandings.filter((entry) => entry.landing.kind === "city").map(toHubLink)),
      },
      {
        title: copy.areas,
        links: sortLinks(curatedLandings.filter((entry) => entry.landing.kind === "city-area").map(toHubLink)),
      },
      {
        title: copy.types,
        links: sortLinks(curatedLandings.filter((entry) => entry.landing.kind === "city-type").map(toHubLink)),
      },
      {
        title: copy.areaTypes,
        links: sortLinks(curatedLandings.filter((entry) => entry.landing.kind === "city-area-type").map(toHubLink)).slice(0, 12),
      },
      {
        title: copy.popular,
        links: sortLinks(curatedLandings.filter((entry) => entry.landing.kind === "city-popular").map(toHubLink)),
      },
    ].filter((section) => section.links.length > 0);
  }

  const relatedLinks = eligibleLandings
    .filter((entry) => entry.showInSitemap)
    .filter((entry) => entry.landing.seoKey !== landing.seoKey)
    .filter((entry) => entry.landing.city.slug === landing.city.slug)
    .filter((entry) => {
      if (!landing.area) return true;
      return (
        entry.landing.area?.slug === landing.area.slug ||
        entry.landing.kind === "city-area" ||
        entry.landing.kind === "city-type" ||
        entry.landing.kind === "city-popular"
      );
    })
    .map((entry) => ({
      ...toHubLink(entry),
      score:
        entry.score +
        (entry.landing.area?.slug && entry.landing.area.slug === landing.area?.slug ? 25 : 0) +
        (entry.landing.type?.slug && entry.landing.type.slug === landing.type?.slug ? 12 : 0),
    }));

  return [
    {
      title: copy.related,
      links: sortLinks(relatedLinks).slice(0, 12),
    },
  ].filter((section) => section.links.length > 0);
}
