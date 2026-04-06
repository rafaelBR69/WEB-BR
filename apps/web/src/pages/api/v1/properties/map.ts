import type { APIRoute } from "astro";
import { DEFAULT_LANG, isSupportedLang } from "@shared/i18n/languages";
import {
  applyFilters,
  getPublicPropertiesWithFallback,
  normalizeVisiblePublicPropertyCards,
} from "@shared/properties/public";
import { parseCatalogActiveFilters } from "@shared/properties/catalogFilters";
import { buildCompactPropertyMapFeatures } from "@shared/properties/compactMapFeatures";

const sortCardsForMap = (cards: any[]) =>
  [...cards].sort((left, right) => {
    const byPriority = (right.priority ?? 0) - (left.priority ?? 0);
    if (byPriority !== 0) return byPriority;
    return (right.priceDisplay ?? right.price ?? 0) - (left.priceDisplay ?? left.price ?? 0);
  });

export const GET: APIRoute = async ({ url }) => {
  const requestedLang = String(url.searchParams.get("lang") ?? DEFAULT_LANG).trim().toLowerCase();
  const lang = isSupportedLang(requestedLang) ? requestedLang : DEFAULT_LANG;
  const { properties } = await getPublicPropertiesWithFallback({
    query: {
      selectProfile: "card",
    },
  });

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

  const filteredCards = applyFilters(cards, activeFilters);
  const sortedCards = sortCardsForMap(filteredCards);
  const features = buildCompactPropertyMapFeatures(sortedCards, properties, lang);

  return new Response(
    JSON.stringify({
      type: "FeatureCollection",
      features,
    }),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
      },
    }
  );
};
