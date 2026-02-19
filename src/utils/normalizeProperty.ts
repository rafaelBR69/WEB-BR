export function normalizeProperty(property: any, lang: string) {
  if (!property) return null;

  const translations = property.translations?.[lang] ?? {};
  const raw = property.property ?? {};
  const rawLocation = property.location ?? {};
  const rawMedia = property.media ?? {};
  const rawGallery = rawMedia.gallery ?? {};
  const asList = (value: any) => (Array.isArray(value) ? value : []);
  const living = asList(rawGallery.living);
  const bedroom = asList(rawGallery.bedroom);
  const kitchen = asList(rawGallery.kitchen);
  const bathroom = asList(rawGallery.bathroom);
  const exterior = asList(rawGallery.exterior);
  const interior = asList(rawGallery.interior);
  const views = asList(rawGallery.views);
  const floorplan = asList(rawGallery.floorplan);
  const fallbackCover =
    exterior[0] ??
    interior[0] ??
    living[0] ??
    bedroom[0] ??
    kitchen[0] ??
    bathroom[0] ??
    views[0] ??
    floorplan[0] ??
    null;

  const seoRaw = translations.seo ?? {};
  const status = property.status ?? "available";
  const listingType = property.listing_type ?? "unit";
  const isPromotion = listingType === "promotion";

  const noindexByStatus =
    status === "sold" || status === "private";

  const visibleByStatus =
    status !== "private";


  return {
    id: property.id,
    status,
    visible: visibleByStatus,
    listingType,
    isPromotion,

    price: property.price ?? null,
    currency: property.currency ?? "EUR",

    text: {
      title: translations.title ?? "",
      description: translations.description ?? [],
    },

    seo: {
      title:
        seoRaw.title ??
        translations.title ??
        "Propiedad en venta | BlancaReal",

      description:
        seoRaw.description ??
        translations.excerpt ??
        translations.title ??
        "",

      noindex: seoRaw.noindex ?? noindexByStatus,

      og: {
        image: rawMedia.cover ?? fallbackCover ?? null,
        type: "website",
      },
    },

    details: {
      bedrooms: raw.bedrooms ?? null,
      bathrooms: raw.bathrooms ?? null,
      garages: raw.garages ?? null,

      area_m2: raw.area_m2 ?? null,
      usable_area_m2: raw.usable_area_m2 ?? null,
      terrace_m2: raw.terrace_m2 ?? null,
      garden_m2: raw.garden_m2 ?? null,

      orientation: raw.orientation ?? null,
    },

    location: {
      area: rawLocation.area ?? "",
      province: rawLocation.province ?? "",
      coordinates: rawLocation.coordinates ?? null,
    },

    media: {
      cover: rawMedia.cover ?? fallbackCover ?? null,
      gallery: {
        living,
        bedroom,
        kitchen,
        bathroom,
        exterior,
        interior,
        views,
        floorplan,
      },
    },
  };
}
