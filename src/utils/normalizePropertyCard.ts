import { formatFeature } from "@/utils/formatFeature";
import { matchType } from "@/utils/matchType";
import { normalizeCity } from "@/utils/normalizeCity";
import { normalizeArea } from "@/utils/normalizeArea";
import { buildSearchText, normalizeSearchText } from "@/utils/search";

export function normalizePropertyCard(property, lang) {
  if (!property) return null;

  const t = property.translations?.[lang] ?? {};
  const raw = property.property ?? {};
  const location = property.location ?? {};

  const status = property.status ?? "available";
  const visible = status !== "private";
  const listingType = property.listing_type ?? "unit";
  const isPromotion = listingType === "promotion";
  const isUnit = !isPromotion;

  const typeKey = matchType(raw.type);
  const cityKey = property.location?.city
    ? normalizeCity(property.location.city)
    : null;

  const marketKey = raw.market ?? null;

  const areaKey = location.area
    ? normalizeArea(location.area)
    : null;

  const features = (property.features || [])
    .map((key) => formatFeature(key, lang))
    .filter(Boolean);

  const searchText = buildSearchText(property);
  const searchTextNormalized = normalizeSearchText(searchText);

  const priceFrom = isPromotion ? property.pricing?.from ?? null : null;
  const price = isPromotion ? null : property.price ?? null;
  const priceDisplay = isPromotion ? priceFrom : price;
  const cover =
    property.media?.cover ??
    property.media?.gallery?.exterior?.[0] ??
    property.media?.gallery?.interior?.[0] ??
    property.media?.gallery?.views?.[0] ??
    null;

  return {
    id: property.id ?? null,
    status,
    isAvailable: status === "available",
    visible,

    slug: property.slugs?.[lang],
    title: t.title ?? "",
    cover,
    price,
    currency: property.currency ?? "EUR",
    priority: typeof property.priority === "number" ? property.priority : 0,
    listingType,
    isPromotion,
    isUnit,
    parentId: property.parent_id ?? null,
    priceFrom,
    priceDisplay,

    typeKey,
    cityKey,
    marketKey,
    areaKey,

    details: {
      bedrooms: raw.bedrooms ?? null,
      bathrooms: raw.bathrooms ?? null,
      area_m2: raw.area_m2 ?? null,
      floor_level: typeof raw.floor_level === "number" ? raw.floor_level : null,
      floor_label: raw.floor_label ?? null,
      floor_filter:
        raw.floor_label ??
        (typeof raw.floor_level === "number"
          ? `Planta ${raw.floor_level}`
          : null),
      orientation: raw.orientation ?? null,
    },

    features,
    searchText: searchTextNormalized,
  };
}
