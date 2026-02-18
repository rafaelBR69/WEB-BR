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
      locationConnector: "en",
    },
    en: {
      title: "Properties for sale on the Costa del Sol",
      description:
        "Discover properties for sale on the Costa del Sol with professional guidance.",
      locationConnector: "in",
    },
    de: {
      title: "Immobilien zum Verkauf an der Costa del Sol",
      description:
        "Entdecken Sie Immobilien zum Verkauf an der Costa del Sol mit professioneller Beratung.",
      locationConnector: "in",
    },
    fr: {
      title: "Proprietes a vendre sur la Costa del Sol",
      description:
        "Decouvrez des proprietes a vendre sur la Costa del Sol avec un accompagnement professionnel.",
      locationConnector: "a",
    },
    it: {
      title: "Proprieta in vendita in Costa del Sol",
      description:
        "Scopri proprieta in vendita in Costa del Sol con consulenza professionale.",
      locationConnector: "a",
    },
    nl: {
      title: "Woningen te koop aan de Costa del Sol",
      description:
        "Ontdek woningen te koop aan de Costa del Sol met professionele begeleiding.",
      locationConnector: "in",
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
      ? `${base.title} ${base.locationConnector} ${locationLabel}`
      : base.title,

    description: shouldAppendLocation
      ? `${base.description} ${base.locationConnector} ${locationLabel}.`
      : base.description,

    noindex: !shouldIndex,
  };
}
