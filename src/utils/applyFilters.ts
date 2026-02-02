export function applyFilters(cards, filters) {
  const hasUnitFilters =
    typeof filters.priceMin === "number" ||
    typeof filters.priceMax === "number";

  return cards.filter((card) => {
    if (!card.visible) return false;

    if (card.listingType === "unit" && card.parentId) {
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

    // MARKET
    if (filters.market && card.marketKey !== filters.market) {
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

    return true;
  });
}
