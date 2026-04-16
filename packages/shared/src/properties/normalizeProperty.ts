import { resolvePrimaryMediaItem } from "@shared/properties/resolvePropertyMedia";

const normalizeMediaEntry = (entry: any) => {
  if (typeof entry === "string") {
    const url = entry.trim();
    return url ? { url } : null;
  }
  if (entry && typeof entry === "object" && typeof entry.url === "string" && entry.url.trim()) {
    return entry;
  }
  return null;
};

const normalizeMediaList = (value: any) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => normalizeMediaEntry(entry))
    .filter((entry): entry is { url: string } => Boolean(entry));

export function normalizeProperty(property: any, lang: string) {
  if (!property) return null;

  const translations = property.translations?.[lang] ?? {};
  const raw = property.property ?? {};
  const rawLocation = property.location ?? {};
  const rawMedia = property.media ?? {};
  const rawGallery = rawMedia.gallery ?? {};
  const living = normalizeMediaList(rawGallery.living);
  const bedroom = normalizeMediaList(rawGallery.bedroom);
  const kitchen = normalizeMediaList(rawGallery.kitchen);
  const bathroom = normalizeMediaList(rawGallery.bathroom);
  const exterior = normalizeMediaList(rawGallery.exterior);
  const interior = normalizeMediaList(rawGallery.interior);
  const views = normalizeMediaList(rawGallery.views);
  const floorplan = normalizeMediaList(rawGallery.floorplan);
  const fallbackCover = normalizeMediaEntry(resolvePrimaryMediaItem(rawMedia));

  const seoRaw = translations.seo ?? {};
  const status = property.status ?? "available";
  const listingType = property.listing_type ?? "unit";
  const isPromotion = listingType === "promotion";

  return {
    id: property.id,
    status,
    visible: status !== "private",
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
      noindex: seoRaw.noindex ?? (status === "sold" || status === "private"),
      og: {
        image: fallbackCover ?? null,
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
      cover: fallbackCover ?? null,
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
