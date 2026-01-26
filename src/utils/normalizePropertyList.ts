export function normalizePropertyList({
  lang,
  city,
  area,
  type,
  market,
  province,
  hasTechnicalFilters = false,
}) {
  const defaultsByLang = {
    es: {
      title: "Propiedades en venta en la Costa del Sol",
      description:
        "Descubre propiedades en venta en la Costa del Sol: casas, apartamentos y villas con asesoramiento profesional.",
    },
    en: {
      title: "Properties for sale on the Costa del Sol",
      description:
        "Discover properties for sale on the Costa del Sol with professional guidance.",
    },
  };

  const base = defaultsByLang[lang] ?? defaultsByLang.es;

  const semanticFilters = [city, area, type, market].filter(Boolean).length;

  const shouldIndex =
    semanticFilters > 0 &&
    semanticFilters <= 2 &&
    !hasTechnicalFilters;

  const locationLabel = area || city || province;

  return {
    title: locationLabel
      ? `${base.title} en ${locationLabel}`
      : base.title,

    description: locationLabel
      ? `${base.description} en ${locationLabel}.`
      : base.description,

    noindex: !shouldIndex,
  };
}
