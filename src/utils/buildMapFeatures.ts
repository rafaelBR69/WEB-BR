export function buildMapFeatures(properties: any[], lang: string) {
  const resolveCoverUrl = (property: any) => {
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

      const availableUnits = isPromotion
        ? properties.filter(
            (unit) =>
              String(unit.parent_id) === String(property.id) &&
              unit.listing_type === "unit" &&
              unit.status === "available"
          ).length
        : null;

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
          listingType,
          availableUnits: availableUnits ?? "",
          href: `/${lang}/property/${slug}/`,
        },
      };
    })
    .filter(Boolean);
}
