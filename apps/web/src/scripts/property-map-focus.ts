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

const promotePropertyCard = (card: HTMLElement) => {
  const grid = card.closest(".properties-grid");
  if (grid instanceof HTMLElement && grid.firstElementChild !== card) {
    grid.prepend(card);
  }

  clearFocusedCards(document);
  card.classList.remove("is-map-focused");
  void card.offsetWidth;
  card.classList.add("is-map-focused");
  card.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
    inline: "nearest",
  });

  window.setTimeout(() => {
    card.classList.remove("is-map-focused");
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
