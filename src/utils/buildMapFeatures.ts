import { buildSupabaseImageUrl } from "@/utils/supabaseImage";

export function buildMapFeatures(properties: any[], lang: string) {
  const toFiniteNumber = (value: unknown) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const getRange = (values: number[]) => {
    if (!values.length) return { min: null, max: null };
    return {
      min: Math.min(...values),
      max: Math.max(...values),
    };
  };

  const resolveCoverUrl = (property: any) => {
    const cover =
      property?.media?.cover ??
      property?.media?.gallery?.exterior?.[0] ??
      property?.media?.gallery?.interior?.[0] ??
      property?.media?.gallery?.views?.[0] ??
      null;

    if (!cover) return "";
    const raw = typeof cover === "string" ? cover : String(cover?.url ?? "");
    return buildSupabaseImageUrl(raw, { width: 360, quality: 70 });
  };

  const resolveRawCoverUrl = (property: any) => {
    const cover =
      property?.media?.cover ??
      property?.media?.gallery?.exterior?.[0] ??
      property?.media?.gallery?.interior?.[0] ??
      property?.media?.gallery?.views?.[0] ??
      null;

    if (!cover) return "";
    if (typeof cover === "string") return cover;
    return String(cover?.url ?? "");
  };

  return properties
    .filter((property) => property.status === "available")
    .filter((property) => property.location?.coordinates?.lat && property.location?.coordinates?.lng)
    .filter((property) => !(property.listing_type === "unit" && property.parent_id))
    .map((property) => {
      const slug = property.slugs?.[lang] ?? property.slugs?.es;
      if (!slug) return null;

      const translation = property.translations?.[lang] ?? property.translations?.es ?? {};
      const area = property.location?.area ?? "";
      const city = property.location?.city ?? "";
      const listingType = property.listing_type ?? "unit";
      const isPromotion = listingType === "promotion";

      const relatedAvailableUnits = isPromotion
        ? properties.filter(
            (unit) =>
              String(unit.parent_id) === String(property.id) &&
              unit.listing_type === "unit" &&
              unit.status === "available"
          )
        : [];

      const availableUnits = isPromotion
        ? relatedAvailableUnits.length
        : null;

      const summaryCurrency = property.currency ?? property.pricing?.currency ?? "EUR";

      const summaryPriceValues = isPromotion
        ? relatedAvailableUnits
            .map((unit) => toFiniteNumber(unit?.price ?? unit?.pricing?.from))
            .filter((value): value is number => value !== null && value > 0)
        : [];
      const summaryPriceFallback = toFiniteNumber(property?.pricing?.from ?? property?.price);
      const summaryPrice = summaryPriceValues.length
        ? Math.min(...summaryPriceValues)
        : summaryPriceFallback;

      const summarySource = isPromotion && relatedAvailableUnits.length
        ? relatedAvailableUnits
        : [property];
      const summaryBedroomsValues = summarySource
        .map((item) => toFiniteNumber(item?.property?.bedrooms))
        .filter((value): value is number => value !== null && value > 0);
      const summaryAreaValues = summarySource
        .map((item) => toFiniteNumber(item?.property?.area_m2))
        .filter((value): value is number => value !== null && value > 0);
      const summaryBedroomsRange = getRange(summaryBedroomsValues);
      const summaryAreaRange = getRange(summaryAreaValues);

      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [
            Number(property.location.coordinates.lng),
            Number(property.location.coordinates.lat),
          ],
        },
        properties: {
          id: property.id,
          title: translation.title ?? property.id,
          area,
          city,
          coverUrl: resolveCoverUrl(property),
          coverUrlFallback: resolveRawCoverUrl(property),
          listingType,
          availableUnits: availableUnits ?? "",
          summaryPrice: summaryPrice ?? "",
          summaryCurrency,
          summaryBedroomsMin: summaryBedroomsRange.min ?? "",
          summaryBedroomsMax: summaryBedroomsRange.max ?? "",
          summaryAreaMin: summaryAreaRange.min ?? "",
          summaryAreaMax: summaryAreaRange.max ?? "",
          href: `/${lang}/property/${slug}/`,
        },
      };
    })
    .filter(Boolean);
}
