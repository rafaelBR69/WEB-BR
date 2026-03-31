import { buildSupabaseImageUrl } from "@shared/media/supabaseImage";

export function buildCompactPropertyMapFeatures(cards: any[], properties: any[], lang: string) {
  const propertyById = new Map(properties.map((property) => [String(property.id ?? ""), property]));

  return cards
    .map((card) => {
      const property = propertyById.get(String(card.id ?? ""));
      const lng = Number(property?.location?.coordinates?.lng);
      const lat = Number(property?.location?.coordinates?.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || !card.slug) return null;

      const rawCoverUrl =
        typeof card.cover === "string"
          ? card.cover
          : String(card.cover?.url ?? "");
      const coverUrl = rawCoverUrl
        ? buildSupabaseImageUrl(rawCoverUrl, { width: 360, quality: 70 })
        : "";

      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [lng, lat],
        },
        properties: {
          id: card.id,
          title: card.title,
          area: property?.location?.area ?? "",
          city: property?.location?.city ?? "",
          coverUrl,
          coverUrlFallback: rawCoverUrl,
          listingType: card.listingType ?? "unit",
          availableUnits: "",
          summaryPrice: card.priceDisplay ?? card.price ?? "",
          summaryCurrency: card.currency ?? "EUR",
          summaryBedroomsMin: card.details?.bedrooms ?? "",
          summaryBedroomsMax: card.details?.bedrooms ?? "",
          summaryAreaMin: card.details?.area_m2 ?? "",
          summaryAreaMax: card.details?.area_m2 ?? "",
          href: `/${lang}/property/${card.slug}/`,
        },
      };
    })
    .filter(Boolean);
}
