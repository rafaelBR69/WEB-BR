import { normalizeSearchText } from "@/utils/search";
import { isVillaFloorLabel, normalizeFloorFilterLabel } from "@/utils/floorFilter";

export function applyFilters(cards, filters) {
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
    if (!card.visible) return false;
    if (card.status === "sold") return false;

    if (!hasUnitFilters) {
      if (card.listingType === "unit" && card.parentId) {
        return false;
      }
    } else if (card.isPromotion && filters.listingType !== "promotion") {
      return false;
    }

    // ⛔ PROMOCIONES NO PASAN FILTROS DE UNIDAD
    if (hasUnitFilters && card.isPromotion) {
      return false;
    }

    // CITY
    if (filters.city && card.cityKey !== filters.city) {
      return false;
    }

    // AREA
    if (filters.area && card.areaKey !== filters.area) {
      return false;
    }

    // TYPE
    if (filters.type) {
      const types = Array.isArray(filters.type) ? filters.type : [filters.type];
      if (!types.includes(card.typeKey)) {
        return false;
      }
    }

    // BEDROOMS
    if (filters.bedrooms) {
      const bedrooms = Array.isArray(filters.bedrooms) ? filters.bedrooms : [filters.bedrooms];
      if (!bedrooms.includes(card.details?.bedrooms)) {
        return false;
      }
    }

    // FLOOR FILTER (label-based)
    if (hasFloorFilters) {
      const cardFloor = normalizeFloorFilterLabel(card.details?.floor_filter);
      if (!cardFloor || !selectedFloors.includes(cardFloor)) {
        return false;
      }
    }

    // MARKET
    if (filters.market && card.marketKey !== filters.market) {
      return false;
    }

    // LISTING TYPE
    if (filters.listingType && card.listingType !== filters.listingType) {
      return false;
    }

    // PRICE MIN (solo unidades)
    if (
      typeof filters.priceMin === "number" &&
      typeof card.price === "number" &&
      card.price < filters.priceMin
    ) {
      return false;
    }

    // PRICE MAX (solo unidades)
    if (
      typeof filters.priceMax === "number" &&
      typeof card.price === "number" &&
      card.price > filters.priceMax
    ) {
      return false;
    }

    if (refQuery) {
      const refCandidates = [
        card.id,
        card.parentId,
        card.slug,
      ]
        .filter(Boolean)
        .map((value) => normalizeSearchText(value));

      const matchedRef = refCandidates.some((value) => value.includes(refQuery));
      if (!matchedRef) return false;
    }

    if (searchTerms.length > 0) {
      const haystack = card.searchText ?? "";
      const matched = searchTerms.every((term) => haystack.includes(term));
      if (!matched) return false;
    }

    return true;
  });
}
