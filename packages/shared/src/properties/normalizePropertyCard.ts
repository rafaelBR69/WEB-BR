import { formatFeature } from "@shared/properties/formatFeature";
import { matchType } from "@shared/properties/matchType";
import { normalizeCity } from "@shared/properties/normalizeCity";
import { normalizeArea } from "@shared/properties/normalizeArea";
import { normalizeFloorFilterLabel } from "@shared/properties/floorFilter";
import {
  buildSearchText,
  normalizeSearchText,
  tokenizeSearchText,
} from "@shared/properties/search";
import {
  resolveMediaGalleryItems,
  resolvePrimaryMediaItem,
} from "@shared/properties/resolvePropertyMedia";

const normalizedPropertyCardsCache = new WeakMap<object[], Map<string, NormalizedPropertyCard[]>>();
const visibleNormalizedPropertyCardsCache = new WeakMap<
  object[],
  Map<string, NormalizedPropertyCard[]>
>();

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
  const featureKeys = Array.isArray(property.features)
    ? property.features.filter((key: string) => typeof key === "string")
    : [];

  const searchText = buildSearchText(property);
  const searchTextNormalized = normalizeSearchText(searchText);
  const searchTokens = Array.from(new Set(tokenizeSearchText(searchTextNormalized)));

  const priceFrom = isPromotion ? property.pricing?.from ?? null : null;
  const price = isPromotion ? null : property.price ?? null;
  const cover = resolvePrimaryMediaItem(property.media);
  const galleryPreview = resolveMediaGalleryItems(property.media);
  const slug = typeof property.slugs?.[lang] === "string" ? property.slugs[lang].trim() : "";
  const title = typeof translation.title === "string" ? translation.title.trim() : "";

  // Skip malformed public records so they never render as empty cards with undefined links.
  if (!slug || !title) return null;

  return {
    id: property.id ?? null,
    status,
    isAvailable: status === "available",
    visible,
    slug,
    title,
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
    featureKeys,
    searchText: searchTextNormalized,
    searchTokens,
    searchScore: 0,
  };
}

export type NormalizedPropertyCard = NonNullable<ReturnType<typeof normalizePropertyCard>>;

export function normalizePublicPropertyCards(
  properties: any[],
  lang: string
): NormalizedPropertyCard[] {
  if (!Array.isArray(properties) || properties.length === 0) {
    return [];
  }

  const cacheKey = properties as object[];
  const cachedByLang = normalizedPropertyCardsCache.get(cacheKey);
  const cachedCards = cachedByLang?.get(lang);
  if (cachedCards) {
    return cachedCards;
  }

  const cards = properties.filter(Boolean)
    .map((property) => normalizePropertyCard(property, lang))
    .filter((card): card is NormalizedPropertyCard => Boolean(card));

  const nextCache = cachedByLang ?? new Map<string, NormalizedPropertyCard[]>();
  nextCache.set(lang, cards);
  normalizedPropertyCardsCache.set(cacheKey, nextCache);

  return cards;
}

export function normalizeVisiblePublicPropertyCards(
  properties: any[],
  lang: string
): NormalizedPropertyCard[] {
  if (!Array.isArray(properties) || properties.length === 0) {
    return [];
  }

  const cacheKey = properties as object[];
  const cachedByLang = visibleNormalizedPropertyCardsCache.get(cacheKey);
  const cachedCards = cachedByLang?.get(lang);
  if (cachedCards) {
    return cachedCards;
  }

  const cards = normalizePublicPropertyCards(properties, lang).filter((card) => card.visible);

  const nextCache = cachedByLang ?? new Map<string, NormalizedPropertyCard[]>();
  nextCache.set(lang, cards);
  visibleNormalizedPropertyCardsCache.set(cacheKey, nextCache);

  return cards;
}
