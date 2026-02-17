import {
  isVillaFloorLabel,
  normalizeFloorFilterLabel,
  sortFloorFilterLabels,
} from "@/utils/floorFilter";

export function buildFilters(cards) {
  const visible = cards.filter((c) => c.visible && c.status !== "sold");
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  const uniqNumbers = (arr) => [...new Set(arr.filter((n) => typeof n === "number"))].sort((a, b) => a - b);
  const uniqStrings = (arr) => [...new Set(arr.filter((s) => typeof s === "string" && s.trim().length))];

  const floors = sortFloorFilterLabels(
    uniqStrings(
      visible
        .filter((c) => c.typeKey !== "villas")
        .map((c) => normalizeFloorFilterLabel(c.details?.floor_filter))
        .filter((floor): floor is string => typeof floor === "string" && !isVillaFloorLabel(floor))
    )
  );

  const areasByCity = {};

  visible.forEach((c) => {
    if (!c.cityKey) return;

    if (!areasByCity[c.cityKey]) {
      areasByCity[c.cityKey] = [];
    }

    if (c.areaKey && !areasByCity[c.cityKey].includes(c.areaKey)) {
      areasByCity[c.cityKey].push(c.areaKey);
    }
  });


  return {
    types: uniq(visible.map((c) => c.typeKey)),
    cities: uniq(visible.map((c) => c.cityKey)),
    areas: areasByCity,
    markets: uniq(visible.map((c) => c.marketKey)),
    bedrooms: uniqNumbers(visible.map((c) => c.details?.bedrooms)),
    floors,
    listingTypes: uniq(visible.map((c) => c.listingType)),

    price: {
      min: Math.min(...visible.map((c) => c.price).filter(Boolean)),
      max: Math.max(...visible.map((c) => c.price).filter(Boolean)),
    },
  };
}
