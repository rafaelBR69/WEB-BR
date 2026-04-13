const EVENT_NAME = "property-map:focus";
const SENTINEL = "__propertyMapFocusBound";

type PropertyMapFocusDetail = {
  id?: string;
  slug?: string;
  href?: string;
};

const normalizeHref = (value: string | null | undefined) => {
  const href = String(value ?? "").trim();
  if (!href) return "";
  return href.replace(/\/+$/, "");
};

const clearFocusedCards = (scope: ParentNode = document) => {
  scope.querySelectorAll<HTMLElement>(".property-card.is-map-focused").forEach((card) => {
    card.classList.remove("is-map-focused");
  });
};

const getFeaturedShowcaseSlot = () =>
  document.querySelector<HTMLElement>(".properties-showcase-featured");

const getPropertiesGrid = () => document.querySelector<HTMLElement>(".properties-grid");

const findMatchingCard = (detail: PropertyMapFocusDetail) => {
  const cards = Array.from(document.querySelectorAll<HTMLElement>(".property-card[data-map-property-href]"));
  const targetHref = normalizeHref(detail.href);
  const targetSlug = String(detail.slug ?? "").trim();
  const targetId = String(detail.id ?? "").trim();

  return (
    cards.find((card) => normalizeHref(card.dataset.mapPropertyHref) === targetHref && targetHref) ??
    cards.find((card) => String(card.dataset.mapPropertySlug ?? "").trim() === targetSlug && targetSlug) ??
    cards.find((card) => String(card.dataset.mapPropertyId ?? "").trim() === targetId && targetId) ??
    null
  );
};

const buildFeaturedPreviewCard = (card: HTMLElement) => {
  const clone = card.cloneNode(true);
  if (!(clone instanceof HTMLElement)) {
    return card;
  }

  clone.dataset.mapPreviewCard = "true";
  return clone;
};

const promotePropertyCard = (card: HTMLElement) => {
  const featuredSlot = getFeaturedShowcaseSlot();
  const grid = getPropertiesGrid();
  const currentFeaturedCard = featuredSlot?.querySelector<HTMLElement>(".property-card") ?? null;
  let activeCard = card;

  if (featuredSlot instanceof HTMLElement && grid instanceof HTMLElement) {
    const cardAlreadyFeatured =
      featuredSlot.contains(card) ||
      (currentFeaturedCard instanceof HTMLElement &&
        normalizeHref(currentFeaturedCard.dataset.mapPropertyHref) ===
          normalizeHref(card.dataset.mapPropertyHref) &&
        normalizeHref(card.dataset.mapPropertyHref));

    if (!cardAlreadyFeatured) {
      activeCard = buildFeaturedPreviewCard(card);
      featuredSlot.replaceChildren(activeCard);
    } else if (currentFeaturedCard instanceof HTMLElement) {
      activeCard = currentFeaturedCard;
    }
  } else {
    const cardGrid = card.closest(".properties-grid");
    if (cardGrid instanceof HTMLElement && cardGrid.firstElementChild !== card) {
      cardGrid.prepend(card);
    }
  }

  clearFocusedCards(document);
  activeCard.classList.remove("is-map-focused");
  void activeCard.offsetWidth;
  activeCard.classList.add("is-map-focused");
  activeCard.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
    inline: "nearest",
  });

  window.setTimeout(() => {
    activeCard.classList.remove("is-map-focused");
  }, 1800);
};

const handlePropertyMapFocus = (event: Event) => {
  const customEvent = event as CustomEvent<PropertyMapFocusDetail>;
  const detail = customEvent.detail;
  if (!detail) return;
  const card = findMatchingCard(detail);
  if (!card) return;
  promotePropertyCard(card);
};

declare global {
  interface Window {
    __propertyMapFocusBound?: boolean;
  }
}

if (typeof window !== "undefined" && !window[SENTINEL]) {
  window[SENTINEL] = true;
  window.addEventListener(EVENT_NAME, handlePropertyMapFocus as EventListener);
}

export {};
