import {
  normalizeSearchText,
  scoreSearchQueryMatch,
} from "@shared/properties/search";
import {
  isVillaFloorLabel,
  normalizeFloorFilterLabel,
} from "@shared/properties/floorFilter";

export function applyFilters(cards: any[], filters: any) {
  const searchQuery = filters.search ? normalizeSearchText(filters.search) : "";
  const searchTerms = searchQuery ? searchQuery.split(" ").filter(Boolean) : [];
  const refQuery = filters.ref ? normalizeSearchText(filters.ref) : "";
  const hasTextSearch = searchTerms.length > 0 || Boolean(refQuery);
  const selectedFloorsRaw = Array.isArray(filters.floor)
    ? filters.floor
    : filters.floor
      ? [filters.floor]
      : [];
  const selectedFloors = selectedFloorsRaw
    .map((value) => normalizeFloorFilterLabel(value))
    .filter((value): value is string => typeof value === "string" && !isVillaFloorLabel(value));
  const hasFloorFilters = selectedFloors.length > 0;

  const hasUnitFilters =
    typeof filters.priceMin === "number" ||
    typeof filters.priceMax === "number" ||
    (Array.isArray(filters.bedrooms) && filters.bedrooms.length > 0) ||
    hasFloorFilters ||
    filters.listingType === "unit" ||
    hasTextSearch;

  return cards.filter((card) => {
    let searchScore = 0;

    if (!card.visible) return false;
    if (card.status === "sold") return false;

    if (!hasUnitFilters) {
      if (card.listingType === "unit" && card.parentId) {
        return false;
      }
    } else if (card.isPromotion && filters.listingType !== "promotion") {
      return false;
    }

    if (hasUnitFilters && card.isPromotion) {
      return false;
    }

    if (filters.city) {
      const cities = Array.isArray(filters.city) ? filters.city : [filters.city];
      if (!cities.includes(card.cityKey)) {
        return false;
      }
    }

    if (filters.area) {
      const areas = Array.isArray(filters.area) ? filters.area : [filters.area];
      if (!areas.includes(card.areaKey)) {
        return false;
      }
    }

    if (filters.type) {
      const types = Array.isArray(filters.type) ? filters.type : [filters.type];
      if (!types.includes(card.typeKey)) {
        return false;
      }
    }

    if (filters.bedrooms) {
      const bedrooms = Array.isArray(filters.bedrooms) ? filters.bedrooms : [filters.bedrooms];
      if (!bedrooms.includes(card.details?.bedrooms)) {
        return false;
      }
    }

    if (hasFloorFilters) {
      const cardFloor = normalizeFloorFilterLabel(card.details?.floor_filter);
      if (!cardFloor || !selectedFloors.includes(cardFloor)) {
        return false;
      }
    }

    if (filters.market && card.marketKey !== filters.market) {
      return false;
    }

    if (filters.listingType && card.listingType !== filters.listingType) {
      return false;
    }

    if (
      typeof filters.priceMin === "number" &&
      typeof card.price === "number" &&
      card.price < filters.priceMin
    ) {
      return false;
    }

    if (
      typeof filters.priceMax === "number" &&
      typeof card.price === "number" &&
      card.price > filters.priceMax
    ) {
      return false;
    }

    if (refQuery) {
      const refCandidates = [card.id, card.parentId, card.slug]
        .filter(Boolean)
        .map((value) => normalizeSearchText(value));

      const exactRefMatch = refCandidates.some((value) => value === refQuery);
      const partialRefMatch = exactRefMatch || refCandidates.some((value) => value.includes(refQuery));
      const matchedRef = partialRefMatch;
      if (!matchedRef) return false;
      searchScore += exactRefMatch ? 40 : 22;
    }

    if (searchTerms.length > 0) {
      const matchResult = scoreSearchQueryMatch(
        searchQuery,
        card.searchText ?? "",
        card.searchTokens ?? []
      );
      if (!matchResult.matched) return false;
      searchScore += matchResult.score;
    }

    card.searchScore = searchScore;
    return true;
  });
}
