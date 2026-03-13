import {
  isVillaFloorLabel,
  normalizeFloorFilterLabel,
  sortFloorFilterLabels,
} from "@shared/properties/floorFilter";

export function buildFilters(cards: any[]) {
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

  return {
    types: uniq(visible.map((card) => card.typeKey)),
    cities: uniq(visible.map((card) => card.cityKey)),
    areas: areasByCity,
    markets: uniq(visible.map((card) => card.marketKey)),
    bedrooms: uniqNumbers(visible.map((card) => card.details?.bedrooms)),
    floors,
    listingTypes: uniq(visible.map((card) => card.listingType)),
    price: {
      min: Math.min(...visible.map((card) => card.price).filter(Boolean)),
      max: Math.max(...visible.map((card) => card.price).filter(Boolean)),
    },
  };
}
