import { formatFeature } from "@shared/properties/formatFeature";
import { matchType } from "@shared/properties/matchType";
import { normalizeCity } from "@shared/properties/normalizeCity";
import { normalizeArea } from "@shared/properties/normalizeArea";
import { normalizeFloorFilterLabel } from "@shared/properties/floorFilter";
import { buildSearchText, normalizeSearchText } from "@shared/properties/search";
import {
  resolveMediaGalleryItems,
  resolvePrimaryMediaItem,
} from "@shared/properties/resolvePropertyMedia";

export function normalizePropertyCard(property: any, lang: string) {
  if (!property) return null;

  const translation = property.translations?.[lang] ?? {};
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
    .map((key: string) => formatFeature(key, lang))
    .filter(Boolean);

  const searchText = buildSearchText(property);
  const searchTextNormalized = normalizeSearchText(searchText);

  const priceFrom = isPromotion ? property.pricing?.from ?? null : null;
  const price = isPromotion ? null : property.price ?? null;
  const cover = resolvePrimaryMediaItem(property.media);
  const galleryPreview = resolveMediaGalleryItems(property.media);

  return {
    id: property.id ?? null,
    status,
    isAvailable: status === "available",
    visible,
    slug: property.slugs?.[lang],
    title: translation.title ?? "",
    cover,
    galleryPreview,
    price,
    currency: property.currency ?? "EUR",
    priority: typeof property.priority === "number" ? property.priority : 0,
    listingType,
    isPromotion,
    isUnit,
    parentId: property.parent_id ?? null,
    priceFrom,
    priceDisplay: isPromotion ? priceFrom : price,
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
      floor_filter: normalizeFloorFilterLabel(
        raw.floor_label ??
          (typeof raw.floor_level === "number"
            ? `Planta ${raw.floor_level}`
            : null)
      ),
      orientation: raw.orientation ?? null,
    },
    features,
    searchText: searchTextNormalized,
  };
}
