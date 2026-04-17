import {
  PROMOTION_AVAILABILITY_CONFIGS,
  type AvailabilityAreaSource,
  type AvailabilityTabMatch,
} from "@shared/properties/propertyAvailabilityConfig";

export type AvailabilityUnitViewModel = {
  id: string;
  slug: string | null;
  href: string | null;
  title: string;
  status: string;
  isAvailable: boolean;
  price: number | null;
  currency: string;
  unitCode: string | null;
  unitNumber: number | null;
  bedrooms: number | null;
  areaM2: number | null;
  terraceM2: number | null;
  gardenM2: number | null;
  floorLabel: string | null;
  block: number | null;
};

export type AvailabilityAreaModel = {
  areaId: string;
  label: string;
  coords: string;
  points: string;
  unitId: string;
  status: string;
  isAvailable: boolean;
};

export type AvailabilityTabModel = {
  tabId: string;
  label: string;
  imageSrc: string;
  viewBox: string;
  imageWidth: number | null;
  imageHeight: number | null;
  units: AvailabilityUnitViewModel[];
  areas: AvailabilityAreaModel[];
  availableCount: number;
  missingMappedUnits: number;
  initialSelectedUnitId: string | null;
};

export type PromotionAvailabilityModel = {
  promotionId: string;
  tabs: AvailabilityTabModel[];
  initialTabId: string | null;
  selectedUnitId: string | null;
};

type AreaResolver =
  | { kind: "unitNumber"; value: number }
  | { kind: "unitCode"; value: string };

const FLOOR_CODE_MAP = new Map<string, string>([
  ["bajo", "B"],
  ["primero", "1"],
  ["segundo", "2"],
  ["tercero", "3"],
  ["cuarto", "4"],
  ["atico", "AT"],
]);

const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const slugify = (value: string) =>
  normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const toNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const pickTranslation = (property: any, lang: string) =>
  property?.translations?.[lang] ??
  property?.translations?.es ??
  property?.translations?.en ??
  {};

const pickTitle = (property: any, lang: string) => {
  const translation = pickTranslation(property, lang);
  return (
    (typeof translation?.title === "string" && translation.title.trim()) ||
    (typeof property?.legacy_code === "string" && property.legacy_code.trim()) ||
    String(property?.id ?? "Unidad")
  );
};

const resolveUnitNumber = (property: any) => {
  const id = String(property?.id ?? "");
  const idMatch = id.match(/-(\d{1,3})$/);
  if (idMatch) return Number(idMatch[1]);

  const title = pickTitle(property, "es");
  const titleMatch = title.match(/\b(?:unidad|unit)\s+(\d{1,3})\b/i);
  if (titleMatch) return Number(titleMatch[1]);

  return null;
};

const resolveUnitCode = (property: any) => {
  const raw = property?.property ?? {};
  if (typeof raw?.unit_code === "string" && raw.unit_code.trim()) return raw.unit_code.trim();
  return null;
};

const resolveFloorLabel = (property: any) => {
  const raw = property?.property ?? {};
  if (typeof raw?.floor_label === "string" && raw.floor_label.trim()) return raw.floor_label.trim();
  const floorLevel = toNumber(raw?.floor_level);
  if (floorLevel === 0) return "Planta baja";
  if (typeof floorLevel === "number") return `Planta ${floorLevel}`;
  return null;
};

const buildUnitHref = (property: any, lang: string) => {
  const slug = property?.slugs?.[lang] ?? property?.slugs?.es ?? null;
  if (!slug || typeof slug !== "string") return null;
  return `/${lang}/property/${slug}`;
};

const normalizeUnit = (property: any, lang: string): AvailabilityUnitViewModel | null => {
  if (!property || typeof property !== "object") return null;
  const id = String(property.id ?? "").trim();
  if (!id) return null;

  const raw = property.property ?? {};
  const slug = typeof (property?.slugs?.[lang] ?? property?.slugs?.es) === "string"
    ? String(property?.slugs?.[lang] ?? property?.slugs?.es)
    : null;

  return {
    id,
    slug,
    href: buildUnitHref(property, lang),
    title: pickTitle(property, lang),
    status: String(property.status ?? "available"),
    isAvailable: String(property.status ?? "available") === "available",
    price: typeof property.price === "number" ? property.price : null,
    currency: typeof property.currency === "string" ? property.currency : "EUR",
    unitCode: resolveUnitCode(property),
    unitNumber: resolveUnitNumber(property),
    bedrooms: toNumber(raw?.bedrooms),
    areaM2: toNumber(raw?.area_m2),
    terraceM2: toNumber(raw?.terrace_m2),
    gardenM2: toNumber(raw?.garden_m2),
    floorLabel: resolveFloorLabel(property),
    block: toNumber(raw?.block),
  };
};

const matchTabUnit = (unit: AvailabilityUnitViewModel, match: AvailabilityTabMatch) => {
  if (match.kind === "all") return true;
  if (match.kind === "block") return unit.block === match.value;
  if (match.kind === "unitRange") {
    return typeof unit.unitNumber === "number" && unit.unitNumber >= match.from && unit.unitNumber <= match.to;
  }
  return false;
};

const parsePoints = (coords: string) => {
  const values = coords
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));
  const pairs: string[] = [];
  for (let index = 0; index < values.length; index += 2) {
    const x = values[index];
    const y = values[index + 1];
    if (typeof x === "number" && typeof y === "number") {
      pairs.push(`${x},${y}`);
    }
  }
  return pairs.join(" ");
};

const computeViewBox = (areas: AvailabilityAreaSource[]) => {
  const values = areas.flatMap((area) =>
    area.coords
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value))
  );

  if (!values.length) return "0 0 100 100";

  const xs = values.filter((_, index) => index % 2 === 0);
  const ys = values.filter((_, index) => index % 2 === 1);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  return `${minX} ${minY} ${width} ${height}`;
};

const compareUnits = (left: AvailabilityUnitViewModel, right: AvailabilityUnitViewModel) => {
  if (typeof left.unitNumber === "number" && typeof right.unitNumber === "number") {
    return left.unitNumber - right.unitNumber;
  }

  if (left.unitCode && right.unitCode) {
    return left.unitCode.localeCompare(right.unitCode, undefined, { numeric: true, sensitivity: "base" });
  }

  return left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: "base" });
};

const parseAlmitakResolver = (label: string): AreaResolver | null => {
  const normalized = normalizeText(label);
  const match = normalized.match(/^(\d+)\s+([a-z]+)\s+([a-z])$/);
  if (!match) return null;
  const portal = Number(match[1]);
  const floorCode = FLOOR_CODE_MAP.get(match[2]);
  const letter = match[3].toUpperCase();
  if (!floorCode) return null;
  const suffix = floorCode === "B" ? `B${letter}` : floorCode === "AT" ? `AT${letter}` : `${floorCode}${letter}`;
  return { kind: "unitCode", value: `P${portal}-${suffix}` };
};

const parseCalahondaResolver = (label: string): AreaResolver | null => {
  const normalized = normalizeText(label);
  const match = normalized.match(/^(\d+)\s+(\d+)\s+([a-z]+)\s+([a-z])$/);
  if (!match) return null;
  const block = Number(match[1]);
  const portal = Number(match[2]);
  const floorCode = FLOOR_CODE_MAP.get(match[3]);
  const letter = match[4].toUpperCase();
  if (!floorCode) return null;
  const suffix = floorCode === "B" ? `B${letter}` : floorCode === "AT" ? `AT${letter}` : `${floorCode}${letter}`;
  return { kind: "unitCode", value: `${block}-${portal}-${suffix}` };
};

const parseNylvaResolver = (label: string): AreaResolver | null => {
  const normalized = normalizeText(label);
  const match = normalized.match(/^unidad\s+(\d+)$/);
  if (!match) return null;
  return { kind: "unitNumber", value: Number(match[1]) };
};

const resolveAreaResolver = (promotionId: string, label: string): AreaResolver | null => {
  if (promotionId === "PM0074") return parseAlmitakResolver(label);
  if (promotionId === "PM0011") return parseCalahondaResolver(label);
  if (promotionId === "PM0079") return parseNylvaResolver(label);
  return null;
};

const matchesResolver = (unit: AvailabilityUnitViewModel, resolver: AreaResolver | null) => {
  if (!resolver) return false;
  if (resolver.kind === "unitNumber") return unit.unitNumber === resolver.value;
  if (resolver.kind === "unitCode") return normalizeText(unit.unitCode ?? "") === normalizeText(resolver.value);
  return false;
};

const findBestTab = (tabs: AvailabilityTabModel[], selectedUnitId: string | null) => {
  if (selectedUnitId) {
    const explicitTab = tabs.find((tab) => tab.units.some((unit) => unit.id === selectedUnitId));
    if (explicitTab) return explicitTab;
  }

  return tabs.find((tab) => tab.availableCount > 0) ?? tabs[0] ?? null;
};

const findInitialUnit = (tab: AvailabilityTabModel, selectedUnitId: string | null) => {
  if (selectedUnitId && tab.units.some((unit) => unit.id === selectedUnitId)) return selectedUnitId;
  return tab.units.find((unit) => unit.isAvailable)?.id ?? tab.units[0]?.id ?? null;
};

export const getPromotionAvailabilityConfig = (promotionId: string | null | undefined): PromotionAvailabilityConfig | null => {
  if (!promotionId) return null;
  return PROMOTION_AVAILABILITY_CONFIGS[String(promotionId)] ?? null;
};

export const buildPromotionAvailabilityModel = ({
  promotionId,
  units,
  lang,
  selectedUnitId = null,
}: {
  promotionId: string | null | undefined;
  units: any[];
  lang: string;
  selectedUnitId?: string | null;
}): PromotionAvailabilityModel | null => {
  const config = getPromotionAvailabilityConfig(promotionId);
  if (!config) return null;

  const normalizedUnits = (Array.isArray(units) ? units : [])
    .map((unit) => normalizeUnit(unit, lang))
    .filter((unit): unit is AvailabilityUnitViewModel => Boolean(unit))
    .sort(compareUnits);

  const tabs = config.tabs.map((tab) => {
    const unitsInTab = normalizedUnits.filter((unit) => matchTabUnit(unit, tab.match));
    const matchedUnitIds = new Set<string>();

    const areas = tab.areas
      .map((area) => {
        const resolver = resolveAreaResolver(config.promotionId, area.label);
        const unit = unitsInTab.find((candidate) => matchesResolver(candidate, resolver));
        if (!unit) return null;
        matchedUnitIds.add(unit.id);
        return {
          areaId: slugify(`${tab.tabId}-${area.label}`),
          label: area.label,
          coords: area.coords,
          points: parsePoints(area.coords),
          unitId: unit.id,
          status: unit.status,
          isAvailable: unit.isAvailable,
        };
      })
      .filter((area): area is AvailabilityAreaModel => Boolean(area));

    const availableCount = unitsInTab.filter((unit) => unit.isAvailable).length;

    return {
      tabId: tab.tabId,
      label: tab.label,
      imageSrc: tab.imageSrc,
      viewBox: tab.viewBox ?? computeViewBox(tab.areas),
      imageWidth: typeof tab.imageWidth === "number" ? tab.imageWidth : null,
      imageHeight: typeof tab.imageHeight === "number" ? tab.imageHeight : null,
      units: unitsInTab,
      areas,
      availableCount,
      missingMappedUnits: unitsInTab.filter((unit) => !matchedUnitIds.has(unit.id)).length,
      initialSelectedUnitId: null,
    };
  }).filter((tab) => tab.units.length > 0);

  if (!tabs.length) return null;

  const initialTab = findBestTab(tabs, selectedUnitId);
  const resolvedSelectedUnitId = initialTab ? findInitialUnit(initialTab, selectedUnitId) : null;

  for (const tab of tabs) {
    tab.initialSelectedUnitId = findInitialUnit(tab, tab.tabId === initialTab?.tabId ? resolvedSelectedUnitId : null);
  }

  return {
    promotionId: String(promotionId),
    tabs,
    initialTabId: initialTab?.tabId ?? null,
    selectedUnitId: resolvedSelectedUnitId,
  };
};
