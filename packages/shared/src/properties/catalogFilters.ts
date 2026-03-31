import { TYPES } from "@shared/data/properties/taxonomies";
import { normalizeArea } from "@shared/properties/normalizeArea";
import { normalizeCity } from "@shared/properties/normalizeCity";
import {
  isVillaFloorLabel,
  normalizeFloorFilterLabel,
} from "@shared/properties/floorFilter";

export type CatalogActiveFilters = {
  city: string[] | null;
  area: string[] | null;
  type: string[] | null;
  feature: string[] | null;
  market: string | null;
  bedrooms: number[] | null;
  floor: string[] | null;
  priceMin: number | null;
  priceMax: number | null;
  search: string | null;
  ref: string | null;
};

const getMultiParam = (searchParams: URLSearchParams, key: string): string[] | null => {
  const values = searchParams.getAll(key)
    .map((value) => String(value).trim())
    .filter(Boolean);
  return values.length ? values : null;
};

const toFiniteNumberOrNull = (value: string | null): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const normalizeCatalogTypeParam = (value: unknown, lang: string): string | null => {
  if (!value) return null;
  const normalized = String(value).toLowerCase().trim();
  if (TYPES[normalized]) return normalized;

  for (const [key, def] of Object.entries(TYPES)) {
    if (def.label?.[lang]?.toLowerCase() === normalized) return key;
    if (def.label?.es?.toLowerCase() === normalized) return key;
  }

  return normalized;
};

export const parseCatalogActiveFilters = ({
  searchParams,
  lang,
  priceBounds,
}: {
  searchParams: URLSearchParams;
  lang: string;
  priceBounds?: { min: number; max: number } | null;
}): CatalogActiveFilters => {
  const activeFilters: CatalogActiveFilters = {
    city: getMultiParam(searchParams, "city")
      ? [...new Set(getMultiParam(searchParams, "city")!.map((value) => normalizeCity(value)).filter(Boolean))]
      : null,
    area: getMultiParam(searchParams, "area")
      ? [...new Set(getMultiParam(searchParams, "area")!.map((value) => normalizeArea(value)).filter(Boolean))]
      : null,
    type: getMultiParam(searchParams, "type")
      ? getMultiParam(searchParams, "type")!
          .map((value) => normalizeCatalogTypeParam(value, lang))
          .filter((value): value is string => typeof value === "string" && value.length > 0)
      : null,
    feature: getMultiParam(searchParams, "feature")
      ? [...new Set(getMultiParam(searchParams, "feature")!.map((value) => String(value).trim()).filter(Boolean))]
      : null,
    market: String(searchParams.get("market") ?? "").trim() || null,
    bedrooms: getMultiParam(searchParams, "bedrooms")
      ? getMultiParam(searchParams, "bedrooms")!
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
      : null,
    floor: getMultiParam(searchParams, "floor")
      ? [...new Set(
          getMultiParam(searchParams, "floor")!
            .map((value) => normalizeFloorFilterLabel(value))
            .filter((value): value is string => typeof value === "string" && !isVillaFloorLabel(value))
        )]
      : null,
    priceMin: toFiniteNumberOrNull(searchParams.get("priceMin")),
    priceMax: toFiniteNumberOrNull(searchParams.get("priceMax")),
    search: String(searchParams.get("q") ?? "").trim() || null,
    ref: String(searchParams.get("ref") ?? "").trim() || null,
  };

  if (priceBounds) {
    if (typeof activeFilters.priceMin === "number" && activeFilters.priceMin <= priceBounds.min) {
      activeFilters.priceMin = null;
    }

    if (typeof activeFilters.priceMax === "number" && activeFilters.priceMax >= priceBounds.max) {
      activeFilters.priceMax = null;
    }
  }

  return activeFilters;
};

export const appendCatalogFiltersToSearchParams = (
  searchParams: URLSearchParams,
  filters: Partial<CatalogActiveFilters> & Record<string, unknown>
) => {
  Object.entries(filters).forEach(([key, value]) => {
    if (key === "listingType") return;
    const paramKey = key === "search" ? "q" : key;

    if (Array.isArray(value)) {
      value
        .filter((item) => item !== null && item !== undefined && String(item).trim() !== "")
        .forEach((item) => {
          searchParams.append(paramKey, String(item));
        });
      return;
    }

    if (value === null || value === undefined) return;

    const text = String(value).trim();
    if (!text.length) return;
    searchParams.set(paramKey, text);
  });
};
