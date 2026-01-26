export function applyFilters(cards, filters) {
  console.log("APPLYING FILTERS:", filters);
  return cards.filter((card) => {
    console.log("CARD:", card);
    console.log("CARD CITY KEY:", card.cityKey);
    console.log("CARD AREA KEY:", card.areaKey);
    console.log("CARD TYPE KEY:", card.typeKey);
    console.log("CARD MARKET KEY:", card.marketKey);
    console.log("CARD PRICE:", card.price);
    console.log("CARD PRICE MIN:", filters.priceMin);
    console.log("CARD PRICE MAX:", filters.priceMax);

    if (!card.visible) return false;

    // CITY
    if (filters.city && card.cityKey !== filters.city) {
      return false;
    }

    // AREA
    if (filters.area && card.areaKey !== filters.area) {
      return false;
    }

    // TYPE
    if (filters.type && card.typeKey !== filters.type) {
      return false;
    }

    // MARKET
    if (filters.market && card.marketKey !== filters.market) {
      return false;
    }

    // PRICE MIN
    if (
      typeof filters.priceMin === "number" &&
      card.price < filters.priceMin
    ) {
      return false;
    }

    // PRICE MAX
    if (
      typeof filters.priceMax === "number" &&
      card.price > filters.priceMax
    ) {
      return false;
    }

    return true;
  });
}
