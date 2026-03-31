import {
  isVillaFloorLabel,
  normalizeFloorFilterLabel,
  sortFloorFilterLabels,
} from "@shared/properties/floorFilter";

export type PropertyFilters = {
  types: string[];
  cities: string[];
  areas: Record<string, string[]>;
  markets: string[];
  bedrooms: number[];
  floors: string[];
  listingTypes: string[];
  price: { min: number; max: number };
};

const buildFiltersCache = new WeakMap<object[], PropertyFilters>();

const buildFiltersBase = (cards: any[]): PropertyFilters => {
  const visible = cards.filter((card) => card.visible && card.status !== "sold");
  const uniq = (values: any[]) => [...new Set(values.filter(Boolean))];
  const uniqNumbers = (values: any[]) =>
    [...new Set(values.filter((value) => typeof value === "number"))].sort((a, b) => a - b);
  const uniqStrings = (values: any[]) =>
    [...new Set(values.filter((value) => typeof value === "string" && value.trim().length))];

  const floors = sortFloorFilterLabels(
    uniqStrings(
      visible
        .filter((card) => card.typeKey !== "villas")
        .map((card) => normalizeFloorFilterLabel(card.details?.floor_filter))
        .filter((floor): floor is string => typeof floor === "string" && !isVillaFloorLabel(floor))
    )
  );

  const areasByCity: Record<string, string[]> = {};

  visible.forEach((card) => {
    if (!card.cityKey) return;

    if (!areasByCity[card.cityKey]) {
      areasByCity[card.cityKey] = [];
    }

    if (card.areaKey && !areasByCity[card.cityKey].includes(card.areaKey)) {
      areasByCity[card.cityKey].push(card.areaKey);
    }
  });

  const priceValues = visible
    .map((card) => card.price)
    .filter((value) => typeof value === "number" && Number.isFinite(value));

  return {
    types: uniq(visible.map((card) => card.typeKey)),
    cities: uniq(visible.map((card) => card.cityKey)),
    areas: areasByCity,
    markets: uniq(visible.map((card) => card.marketKey)),
    bedrooms: uniqNumbers(visible.map((card) => card.details?.bedrooms)),
    floors,
    listingTypes: uniq(visible.map((card) => card.listingType)),
    price: {
      min: priceValues.length ? Math.min(...priceValues) : 0,
      max: priceValues.length ? Math.max(...priceValues) : 0,
    },
  };
};

export function buildFilters(cards: any[]) {
  if (!Array.isArray(cards) || cards.length === 0) {
    return {
      types: [],
      cities: [],
      areas: {},
      markets: [],
      bedrooms: [],
      floors: [],
      listingTypes: [],
      price: { min: 0, max: 0 },
    };
  }

  const cacheKey = cards as object[];
  const cached = buildFiltersCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const filters = buildFiltersBase(cards);
  buildFiltersCache.set(cacheKey, filters);
  return filters;
}
