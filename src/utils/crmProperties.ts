export type PropertyRecordType = "project" | "unit" | "single";
export type OperationType = "sale" | "rent" | "both";
export type ProjectBusinessType =
  | "owned_and_commercialized"
  | "provider_and_commercialized_by_us"
  | "external_listing";

export type PropertyStatus =
  | "draft"
  | "available"
  | "reserved"
  | "sold"
  | "rented"
  | "private"
  | "archived";

export type MediaCategory =
  | "living"
  | "bedroom"
  | "kitchen"
  | "bathroom"
  | "exterior"
  | "interior"
  | "views"
  | "floorplan";

export type PropertyMediaItem = {
  id: string;
  url: string;
  label: string | null;
  alt: Record<string, string>;
};

export type PropertyMediaModel = {
  cover: PropertyMediaItem | null;
  gallery: Record<MediaCategory, PropertyMediaItem[]>;
};

export type PropertyPortalModel = {
  is_enabled: boolean;
  is_explicit: boolean;
  published_at: string | null;
  unpublished_at: string | null;
  updated_at: string | null;
};

export const MEDIA_CATEGORIES: MediaCategory[] = [
  "living",
  "bedroom",
  "kitchen",
  "bathroom",
  "exterior",
  "interior",
  "views",
  "floorplan",
];

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

const asBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.toLowerCase().trim();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  return null;
};

const getPreferredTranslationTitle = (value: unknown): string | null => {
  const translations = asRecord(value);
  const preferredLanguages = ["es", "en", "de", "fr", "it", "nl"];

  for (const language of preferredLanguages) {
    const scoped = asRecord(translations[language]);
    const title = asString(scoped.title);
    if (title) return title;
  }

  for (const scoped of Object.values(translations)) {
    const title = asString(asRecord(scoped).title);
    if (title) return title;
  }
  return null;
};

const toProjectName = (title: string | null): string | null => {
  if (!title) return null;
  const trimmed = title.trim();
  if (!trimmed.length) return null;
  const colonIndex = trimmed.indexOf(":");
  if (colonIndex <= 0) return trimmed;
  const beforeColon = trimmed.slice(0, colonIndex).trim();
  return beforeColon.length ? beforeColon : trimmed;
};

const normalizeAlt = (value: unknown): Record<string, string> => {
  const source = asRecord(value);
  const out: Record<string, string> = {};
  Object.entries(source).forEach(([key, item]) => {
    if (typeof item === "string" && item.trim().length > 0) {
      out[key] = item.trim();
    }
  });
  return out;
};

const toMediaItem = (value: unknown): PropertyMediaItem | null => {
  const source = asRecord(value);
  const url = asString(source.url);
  if (!url) return null;
  const id = asString(source.id) ?? crypto.randomUUID();
  return {
    id,
    url,
    label: asString(source.label),
    alt: normalizeAlt(source.alt),
  };
};

export const getEmptyMediaModel = (): PropertyMediaModel => ({
  cover: null,
  gallery: {
    living: [],
    bedroom: [],
    kitchen: [],
    bathroom: [],
    exterior: [],
    interior: [],
    views: [],
    floorplan: [],
  },
});

export const normalizeMediaModel = (rawMedia: unknown): PropertyMediaModel => {
  const source = asRecord(rawMedia);
  const gallerySource = asRecord(source.gallery);
  const model = getEmptyMediaModel();
  model.cover = toMediaItem(source.cover);

  MEDIA_CATEGORIES.forEach((category) => {
    const rawList = gallerySource[category];
    if (!Array.isArray(rawList)) return;
    model.gallery[category] = rawList
      .map((entry) => toMediaItem(entry))
      .filter((entry): entry is PropertyMediaItem => Boolean(entry));
  });
  return model;
};

export const normalizeRecordType = (value: unknown): PropertyRecordType => {
  if (value === "project" || value === "unit" || value === "single") return value;
  return "single";
};

export const normalizeOperationType = (value: unknown): OperationType => {
  if (value === "sale" || value === "rent" || value === "both") return value;
  return "sale";
};

export const normalizeProjectBusinessType = (value: unknown): ProjectBusinessType => {
  if (
    value === "owned_and_commercialized" ||
    value === "provider_and_commercialized_by_us" ||
    value === "external_listing"
  ) {
    return value;
  }
  return "external_listing";
};

export const normalizePropertyStatus = (value: unknown): PropertyStatus => {
  if (
    value === "draft" ||
    value === "available" ||
    value === "reserved" ||
    value === "sold" ||
    value === "rented" ||
    value === "private" ||
    value === "archived"
  ) {
    return value;
  }
  return "draft";
};

export const mapPropertyRow = (row: Record<string, unknown>) => {
  const propertyData = asRecord(row.property_data);
  const media = normalizeMediaModel(row.media);
  const translations = asRecord(row.translations);
  const recordType = normalizeRecordType(row.record_type);
  const portalEnabledRaw = asBoolean(propertyData.portal_enabled);
  const isPortalProject = recordType === "project";
  const legacyCode = asString(row.legacy_code);
  const title = getPreferredTranslationTitle(translations);
  const displayName = title ?? legacyCode;
  const projectName = recordType === "project" ? toProjectName(title ?? legacyCode) : null;

  return {
    id: row.id ?? null,
    organization_id: row.organization_id ?? null,
    legacy_code: legacyCode,
    display_name: displayName,
    project_name: projectName,
    record_type: recordType,
    project_business_type: normalizeProjectBusinessType(row.project_business_type),
    operation_type: normalizeOperationType(row.operation_type),
    status: normalizePropertyStatus(row.status),
    parent_property_id: row.parent_property_id ?? null,
    website_id: row.website_id ?? null,
    is_featured: Boolean(row.is_featured),
    is_public: row.is_public !== false,
    commercialization_notes: asString(row.commercialization_notes),
    pricing: {
      price_sale: asNumber(row.price_sale),
      price_rent_monthly: asNumber(row.price_rent_monthly),
      currency: asString(row.price_currency) ?? "EUR",
      rent_price_on_request: propertyData.rent_price_on_request === true,
    },
    operational: {
      area_m2: asNumber(propertyData.area_m2),
      usable_area_m2: asNumber(propertyData.usable_area_m2),
      built_area_total_m2: asNumber(propertyData.built_area_total_m2),
      terrace_m2: asNumber(propertyData.terrace_m2),
      exterior_area_m2: asNumber(propertyData.exterior_area_m2),
      garden_m2: asNumber(propertyData.garden_m2),
      plot_m2: asNumber(propertyData.plot_m2),
      bedrooms: asNumber(propertyData.bedrooms),
      bathrooms: asNumber(propertyData.bathrooms),
      garages: asNumber(propertyData.garages),
      storage_rooms: asNumber(propertyData.storage_rooms),
      floor_level: asNumber(propertyData.floor_level),
      floor_label: asString(propertyData.floor_label),
      building_block: asString(propertyData.building_block),
      building_portal: asString(propertyData.building_portal),
      building_door: asString(propertyData.building_door),
      building_name: asString(propertyData.building_name),
      orientation: asString(propertyData.orientation),
      condition: asString(propertyData.condition),
      year_built: asNumber(propertyData.year_built),
      cadastral_ref: asString(propertyData.cadastral_ref),
      energy_rating: asString(propertyData.energy_rating),
      community_fees_monthly: asNumber(propertyData.community_fees_monthly),
      ibi_yearly: asNumber(propertyData.ibi_yearly),
      elevator: asBoolean(propertyData.elevator),
    },
    portal: {
      is_enabled: isPortalProject ? portalEnabledRaw !== false : false,
      is_explicit: portalEnabledRaw !== null,
      published_at: asString(propertyData.portal_published_at),
      unpublished_at: asString(propertyData.portal_unpublished_at),
      updated_at: asString(propertyData.portal_updated_at),
    } as PropertyPortalModel,
    translations,
    location: asRecord(row.location),
    media,
    updated_at: row.updated_at ?? null,
    created_at: row.created_at ?? null,
  };
};

export const mergeOperationalData = (
  currentRaw: unknown,
  updates: {
    area_m2?: number | null;
    usable_area_m2?: number | null;
    built_area_total_m2?: number | null;
    terrace_m2?: number | null;
    exterior_area_m2?: number | null;
    garden_m2?: number | null;
    plot_m2?: number | null;
    bedrooms?: number | null;
    bathrooms?: number | null;
    garages?: number | null;
    storage_rooms?: number | null;
    floor_level?: number | null;
    year_built?: number | null;
    community_fees_monthly?: number | null;
    ibi_yearly?: number | null;
    floor_label?: string | null;
    building_block?: string | null;
    building_portal?: string | null;
    building_door?: string | null;
    building_name?: string | null;
    orientation?: string | null;
    condition?: string | null;
    cadastral_ref?: string | null;
    energy_rating?: string | null;
    elevator?: boolean | null;
    rent_price_on_request?: boolean | null;
    portal_enabled?: boolean | null;
    portal_published_at?: string | null;
    portal_unpublished_at?: string | null;
    portal_updated_at?: string | null;
  }
) => {
  const next = {
    ...asRecord(currentRaw),
  };

  if (updates.area_m2 !== undefined) next.area_m2 = updates.area_m2;
  if (updates.usable_area_m2 !== undefined) next.usable_area_m2 = updates.usable_area_m2;
  if (updates.built_area_total_m2 !== undefined) next.built_area_total_m2 = updates.built_area_total_m2;
  if (updates.terrace_m2 !== undefined) next.terrace_m2 = updates.terrace_m2;
  if (updates.exterior_area_m2 !== undefined) next.exterior_area_m2 = updates.exterior_area_m2;
  if (updates.garden_m2 !== undefined) next.garden_m2 = updates.garden_m2;
  if (updates.plot_m2 !== undefined) next.plot_m2 = updates.plot_m2;
  if (updates.bedrooms !== undefined) next.bedrooms = updates.bedrooms;
  if (updates.bathrooms !== undefined) next.bathrooms = updates.bathrooms;
  if (updates.garages !== undefined) next.garages = updates.garages;
  if (updates.storage_rooms !== undefined) next.storage_rooms = updates.storage_rooms;
  if (updates.floor_level !== undefined) next.floor_level = updates.floor_level;
  if (updates.year_built !== undefined) next.year_built = updates.year_built;
  if (updates.community_fees_monthly !== undefined) {
    next.community_fees_monthly = updates.community_fees_monthly;
  }
  if (updates.ibi_yearly !== undefined) next.ibi_yearly = updates.ibi_yearly;
  if (updates.floor_label !== undefined) next.floor_label = updates.floor_label;
  if (updates.building_block !== undefined) next.building_block = updates.building_block;
  if (updates.building_portal !== undefined) next.building_portal = updates.building_portal;
  if (updates.building_door !== undefined) next.building_door = updates.building_door;
  if (updates.building_name !== undefined) next.building_name = updates.building_name;
  if (updates.orientation !== undefined) next.orientation = updates.orientation;
  if (updates.condition !== undefined) next.condition = updates.condition;
  if (updates.cadastral_ref !== undefined) next.cadastral_ref = updates.cadastral_ref;
  if (updates.energy_rating !== undefined) next.energy_rating = updates.energy_rating;
  if (updates.elevator !== undefined) next.elevator = updates.elevator;
  if (updates.rent_price_on_request !== undefined) {
    next.rent_price_on_request = Boolean(updates.rent_price_on_request);
  }
  if (updates.portal_enabled !== undefined) next.portal_enabled = updates.portal_enabled;
  if (updates.portal_published_at !== undefined) next.portal_published_at = updates.portal_published_at;
  if (updates.portal_unpublished_at !== undefined) next.portal_unpublished_at = updates.portal_unpublished_at;
  if (updates.portal_updated_at !== undefined) next.portal_updated_at = updates.portal_updated_at;
  return next;
};
