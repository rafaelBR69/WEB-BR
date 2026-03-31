import { comparePromotionEditorialOrder, getPromotionEditorialRank } from "../config/promotionOrder";
import { normalizePropertyCard } from "./normalizePropertyCard";

type PublicProperty = Record<string, any>;
const projectShowcaseCache = new WeakMap<PublicProperty[], Map<string, ProjectShowcaseCard[]>>();
const featuredUnitShowcaseCache = new WeakMap<
  PublicProperty[],
  Map<string, FeaturedChildUnitCard[]>
>();

export type ProjectDemandLevel = "last_units" | "high_demand" | "open";

export type ProjectShowcaseCard = {
  id: string;
  title: string;
  intro: string;
  area: string;
  province: string;
  unitsCount: number;
  availableCount: number;
  soldCount: number;
  soldPercent: number;
  priceFrom: number | null;
  priceTo: number | null;
  bedroomsRange: string | null;
  areaRange: string | null;
  deliveryYear: number | null;
  demandLevel: ProjectDemandLevel;
  currency: string;
  coverUrl: string | null;
  coverAlt: string;
  href: string;
  priority: number;
};

export type FeaturedChildUnitCard = ReturnType<typeof normalizePropertyCard> & {
  parentId: string;
  parentTitle: string;
  parentHref: string | null;
};

const getRangeLabel = (values: number[]) => {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return String(min);
  return `${min}-${max}`;
};

const toProjectHeadline = (value: string | null | undefined) => {
  const title = String(value ?? "").trim();
  if (!title) return "";

  const colonIndex = title.indexOf(":");
  if (colonIndex > 0) {
    return title.slice(0, colonIndex).trim();
  }

  return title;
};

const getProjectCover = (property: PublicProperty) =>
  property.media?.cover ??
  property.media?.gallery?.exterior?.[0] ??
  property.media?.gallery?.interior?.[0] ??
  property.media?.gallery?.views?.[0] ??
  null;

const isOwnProject = (property: PublicProperty | undefined | null) =>
  property?.is_own_project === true ||
  property?.project_business_type === "owned_and_commercialized";

const mergeUnitWithParentMedia = (unit: PublicProperty, parent: PublicProperty) => ({
  ...unit,
  media: {
    ...(parent.media ?? {}),
    ...(unit.media ?? {}),
    cover: unit.media?.cover ?? parent.media?.cover ?? null,
    gallery: {
      ...(parent.media?.gallery ?? {}),
      ...(unit.media?.gallery ?? {}),
    },
  },
  features:
    Array.isArray(unit.features) && unit.features.length > 0
      ? unit.features
      : (parent.features ?? []),
});

const buildProjectShowcaseCardsBase = (
  properties: PublicProperty[],
  lang: string
): ProjectShowcaseCard[] => {
  const unitsByParentId = properties.reduce((map, property) => {
    if (
      property?.listing_type !== "unit" ||
      property?.status === "private" ||
      !property?.parent_id
    ) {
      return map;
    }

    const parentId = String(property.parent_id);
    const current = map.get(parentId) ?? [];
    current.push(property);
    map.set(parentId, current);
    return map;
  }, new Map<string, PublicProperty[]>());

  return properties
    .filter((property) => property.listing_type === "promotion")
    .filter((property) => property.status !== "private")
    .filter((property) => isOwnProject(property))
    .filter((property) => property.slugs?.[lang])
    .map((project) => {
      const units = unitsByParentId.get(String(project.id)) ?? [];

      const availableUnits = units.filter((item) => item.status === "available");
      const soldUnits = units.filter((item) => item.status === "sold");
      const unitPrices = availableUnits
        .map((item) => item.price)
        .filter((price): price is number => typeof price === "number" && Number.isFinite(price));
      const bedrooms = units
        .map((item) => item.property?.bedrooms)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      const areas = units
        .map((item) => item.property?.area_m2)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
        .map((value) => Math.round(value));

      const cover = getProjectCover(project);
      const translation = project.translations?.[lang] ?? project.translations?.es ?? {};
      const priceFrom =
        project.pricing?.from ??
        (unitPrices.length ? Math.min(...unitPrices) : null) ??
        project.price ??
        null;
      const priceTo = unitPrices.length ? Math.max(...unitPrices) : null;
      const soldPercent = units.length > 0 ? Math.round((soldUnits.length / units.length) * 100) : 0;
      const demandLevel: ProjectDemandLevel =
        availableUnits.length <= 6
          ? "last_units"
          : soldPercent >= 65
            ? "high_demand"
            : "open";

      return {
        id: String(project.id),
        title: toProjectHeadline(translation.title ?? String(project.id)),
        intro: translation.intro ?? "",
        area: project.location?.area ?? "",
        province: project.location?.province ?? "",
        unitsCount: units.length,
        availableCount: availableUnits.length,
        soldCount: soldUnits.length,
        soldPercent,
        priceFrom,
        priceTo,
        bedroomsRange: getRangeLabel(bedrooms),
        areaRange: getRangeLabel(areas),
        deliveryYear:
          typeof project.property?.year_built === "number" ? project.property.year_built : null,
        demandLevel,
        currency: project.currency ?? "EUR",
        coverUrl: typeof cover === "string" ? cover : cover?.url ?? null,
        coverAlt:
          (typeof cover === "object" ? cover?.alt?.[lang] : null) ??
          (typeof cover === "object" ? cover?.alt?.es : null) ??
          translation.title ??
          String(project.id),
        href: `/${lang}/property/${project.slugs[lang]}/`,
        priority: typeof project.priority === "number" ? project.priority : 0,
      };
    })
    .sort((left, right) => {
      const byEditorial = comparePromotionEditorialOrder(left, right);
      if (byEditorial !== 0) return byEditorial;

      const byAvailability = right.availableCount - left.availableCount;
      if (byAvailability !== 0) return byAvailability;

      const byDemand = right.soldPercent - left.soldPercent;
      if (byDemand !== 0) return byDemand;

      return left.id.localeCompare(right.id, "es");
    });
};

export function buildProjectShowcaseCards(
  properties: PublicProperty[],
  lang: string,
  options: {
    limit?: number;
    allowedIds?: readonly string[];
  } = {}
): ProjectShowcaseCard[] {
  const cachedByLang = projectShowcaseCache.get(properties);
  const cachedCards = cachedByLang?.get(lang);
  const baseCards = cachedCards ?? buildProjectShowcaseCardsBase(properties, lang);

  if (!cachedCards) {
    const nextCache = cachedByLang ?? new Map<string, ProjectShowcaseCard[]>();
    nextCache.set(lang, baseCards);
    projectShowcaseCache.set(properties, nextCache);
  }

  const allowedIds = Array.isArray(options.allowedIds) && options.allowedIds.length
    ? new Set(options.allowedIds.map((id) => String(id)))
    : null;
  const filteredCards = allowedIds
    ? baseCards.filter((card) => allowedIds.has(String(card.id)))
    : baseCards;

  return filteredCards.slice(0, typeof options.limit === "number" ? options.limit : Number.POSITIVE_INFINITY);
}

const buildFeaturedChildUnitCardsBase = (
  properties: PublicProperty[],
  lang: string
): FeaturedChildUnitCard[] => {
  const byId = new Map(properties.map((property) => [String(property.id), property]));
  const grouped = properties
    .filter((property) => property.listing_type === "unit")
    .filter((property) => property.status === "available")
    .filter((property) => property.parent_id)
    .map((unit) => {
      const parent = byId.get(String(unit.parent_id));
      if (!parent || parent.status === "private" || !isOwnProject(parent) || !unit.slugs?.[lang]) {
        return null;
      }

      const normalized = normalizePropertyCard(mergeUnitWithParentMedia(unit, parent), lang);
      if (!normalized?.visible || !normalized.slug) return null;

      const parentTitle =
        parent.translations?.[lang]?.title ??
        parent.translations?.es?.title ??
        String(parent.id);

      return {
        ...normalized,
        parentId: String(parent.id),
        parentTitle,
        parentHref: parent.slugs?.[lang] ? `/${lang}/property/${parent.slugs[lang]}/` : null,
      };
    })
    .filter((card): card is FeaturedChildUnitCard => Boolean(card))
    .reduce((map, card) => {
      const key = card.parentId;
      const current = map.get(key) ?? [];
      current.push(card);
      map.set(key, current);
      return map;
    }, new Map<string, FeaturedChildUnitCard[]>());

  const parentIds = Array.from(grouped.keys()).sort(
    (left, right) => getPromotionEditorialRank(left) - getPromotionEditorialRank(right)
  );

  parentIds.forEach((parentId) => {
    const cards = grouped.get(parentId) ?? [];
    cards.sort((left, right) => {
      const byPriority = (right.priority ?? 0) - (left.priority ?? 0);
      if (byPriority !== 0) return byPriority;

      const leftPrice = typeof left.price === "number" ? left.price : Number.POSITIVE_INFINITY;
      const rightPrice = typeof right.price === "number" ? right.price : Number.POSITIVE_INFINITY;
      if (leftPrice !== rightPrice) return leftPrice - rightPrice;

      return String(left.id ?? "").localeCompare(String(right.id ?? ""), "es", { numeric: true });
    });
  });

  const selection: FeaturedChildUnitCard[] = [];
  const totalCards = Array.from(grouped.values()).reduce((sum, cards) => sum + cards.length, 0);
  let cursor = 0;

  while (selection.length < totalCards) {
    let pushedInRound = false;

    parentIds.forEach((parentId) => {
      const cards = grouped.get(parentId) ?? [];
      const next = cards[cursor];
      if (!next || selection.length >= totalCards) return;
      selection.push(next);
      pushedInRound = true;
    });

    if (!pushedInRound) break;
    cursor += 1;
  }

  return selection;
};

export function buildFeaturedChildUnitCards(
  properties: PublicProperty[],
  lang: string,
  options: {
    limit?: number;
  } = {}
): FeaturedChildUnitCard[] {
  const cachedByLang = featuredUnitShowcaseCache.get(properties);
  const cachedCards = cachedByLang?.get(lang);
  const baseCards = cachedCards ?? buildFeaturedChildUnitCardsBase(properties, lang);

  if (!cachedCards) {
    const nextCache = cachedByLang ?? new Map<string, FeaturedChildUnitCard[]>();
    nextCache.set(lang, baseCards);
    featuredUnitShowcaseCache.set(properties, nextCache);
  }

  const limit = typeof options.limit === "number" ? options.limit : 20;
  return baseCards.slice(0, limit);
}
