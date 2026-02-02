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

  const hasMultiTypes = Array.isArray(type) && type.length > 1;
  const shouldIndex =
    semanticFilters > 0 &&
    semanticFilters <= 2 &&
    !hasTechnicalFilters &&
    !hasMultiTypes;

  const locationLabel = area || city || province;
  const shouldAppendLocation =
    locationLabel && !base.title.includes(locationLabel);

  return {
    title: shouldAppendLocation
      ? `${base.title} en ${locationLabel}`
      : base.title,

    description: shouldAppendLocation
      ? `${base.description} en ${locationLabel}.`
      : base.description,

    noindex: !shouldIndex,
  };
}
