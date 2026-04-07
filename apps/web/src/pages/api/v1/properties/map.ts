import type { APIRoute } from "astro";
import { DEFAULT_LANG, isSupportedLang } from "@shared/i18n/languages";
import {
  applyFilters,
  getPublicPropertiesWithFallback,
  hasUnitLevelFilters,
  normalizePublicPropertyCards,
  normalizeVisiblePublicPropertyCards,
} from "@shared/properties/public";
import { parseCatalogActiveFilters } from "@shared/properties/catalogFilters";
import { buildCompactPropertyMapPayload } from "@shared/properties/compactMapFeatures";

const sortCardsForMap = (cards: any[]) =>
  [...cards].sort((left, right) => {
    const byPriority = (right.priority ?? 0) - (left.priority ?? 0);
    if (byPriority !== 0) return byPriority;
    return (right.priceDisplay ?? right.price ?? 0) - (left.priceDisplay ?? left.price ?? 0);
  });

export const GET: APIRoute = async ({ url }) => {
  const requestedLang = String(url.searchParams.get("lang") ?? DEFAULT_LANG).trim().toLowerCase();
  const lang = isSupportedLang(requestedLang) ? requestedLang : DEFAULT_LANG;
  const shouldIncludeDebug =
    url.searchParams.get("debug") === "1" || import.meta.env.DEV === true;
  const { properties } = await getPublicPropertiesWithFallback({
    query: {
      selectProfile: "card",
    },
  });

  const allCards = normalizePublicPropertyCards(properties, lang);
  const cards = normalizeVisiblePublicPropertyCards(properties, lang);

  const allCardPrices = cards
    .map((card) => card.price)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const catalogPriceBounds = {
    min: allCardPrices.length ? Math.min(...allCardPrices) : 0,
    max: allCardPrices.length ? Math.max(...allCardPrices) : 5_000_000,
  };

  const activeFilters = parseCatalogActiveFilters({
    searchParams: url.searchParams,
    lang,
    priceBounds: catalogPriceBounds,
  });

  const hasUnitFilters = hasUnitLevelFilters(activeFilters);
  const filteredCards = applyFilters(cards, activeFilters);
  const sortedCards = sortCardsForMap(filteredCards);
  const { features, diagnostics: featureDiagnostics } = buildCompactPropertyMapPayload(
    sortedCards,
    properties,
    lang
  );

  const propertyById = new Map(properties.map((property) => [String(property.id ?? ""), property]));
  const availableProperties = properties.filter((property) => property?.status === "available");
  const missingSlugCount = availableProperties.filter((property) => {
    const langSlug = String(property?.slugs?.[lang] ?? "").trim();
    const esSlug = String(property?.slugs?.es ?? "").trim();
    return !(langSlug || esSlug);
  }).length;
  const missingCoordinatesCount = availableProperties.filter((property) => {
    const ownLng = Number(property?.location?.coordinates?.lng);
    const ownLat = Number(property?.location?.coordinates?.lat);
    if (Number.isFinite(ownLng) && Number.isFinite(ownLat)) return false;

    const parent = property?.parent_id ? propertyById.get(String(property.parent_id)) : null;
    const parentLng = Number(parent?.location?.coordinates?.lng);
    const parentLat = Number(parent?.location?.coordinates?.lat);
    return !(Number.isFinite(parentLng) && Number.isFinite(parentLat));
  }).length;
  const rawByListingType = availableProperties.reduce<Record<string, number>>((acc, property) => {
    const key = String(property?.listing_type ?? "unknown");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const unitChildrenCollapsed =
    hasUnitFilters === false
      ? cards.filter((card) => card.listingType === "unit" && card.parentId).length
      : 0;
  const excludedByFilterLogic = Math.max(
    0,
    cards.length - filteredCards.length - unitChildrenCollapsed
  );

  const diagnostics = {
    rows: {
      total: properties.length,
      available: availableProperties.length,
      byListingType: rawByListingType,
      soldOrPrivate: allCards.filter((card) => card.status === "sold" || card.status === "private").length,
      missingSlug: missingSlugCount,
      missingCoordinates: missingCoordinatesCount,
    },
    cards: {
      normalized: allCards.length,
      visible: cards.length,
      filtered: filteredCards.length,
      sorted: sortedCards.length,
      unitChildrenCollapsed,
      excludedByFilters: excludedByFilterLogic,
      hasUnitFilters,
    },
    features: featureDiagnostics,
  };

  if (shouldIncludeDebug) {
    console.info("[properties-map] diagnostics", JSON.stringify(diagnostics));
  }

  return new Response(
    JSON.stringify({
      type: "FeatureCollection",
      features,
      ...(shouldIncludeDebug ? { meta: { diagnostics } } : {}),
    }),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
      },
    }
  );
};
