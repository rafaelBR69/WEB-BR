import {
  getSupabaseServerClient,
  hasSupabaseServerClient,
} from "@shared/supabase/server";
import { normalizePm0074PublicProperty } from "@/utils/normalizePm0074PublicProperty";

type GenericRecord = Record<string, unknown>;
type PublicProperty = Record<string, unknown>;
type PublicPropertiesResult = {
  properties: PublicProperty[];
  source: string;
  count: number | null;
};
type FallbackLoader = () => Promise<PublicProperty[]>;
type PublicListingType = "promotion" | "unit" | "resale" | "rental";
export type PublicPropertiesQuery = {
  ids?: string[];
  listingTypes?: PublicListingType[];
  statuses?: string[];
  parentIds?: string[];
  onlyOwnProjects?: boolean;
  limit?: number;
  slug?: string;
  slugLang?: string;
  countOnly?: boolean;
  selectProfile?: "full" | "card";
};
type NormalizedPublicPropertiesQuery = {
  ids: string[];
  listingTypes: PublicListingType[];
  statuses: string[];
  parentIds: string[];
  onlyOwnProjects: boolean;
  limit: number | null;
  slug: string | null;
  slugLang: string | null;
  countOnly: boolean;
  selectProfile: "full" | "card";
};

const PUBLIC_PROPERTIES_CACHE_TTL_MS = (() => {
  const parsed = Number(import.meta.env.PUBLIC_PROPERTIES_CACHE_TTL_MS ?? 60_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
})();

const publicPropertiesCache = new Map<
  string,
  {
    expiresAt: number;
    value: PublicPropertiesResult | null;
    promise: Promise<PublicPropertiesResult> | null;
  }
>();
let fallbackPropertiesPromise: Promise<PublicProperty[]> | null = null;

const FULL_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "website_id",
  "legacy_code",
  "record_type",
  "project_business_type",
  "operation_type",
  "listing_type",
  "status",
  "is_featured",
  "is_public",
  "price_sale",
  "price_rent_monthly",
  "price_currency",
  "property_data",
  "location",
  "features",
  "media",
  "translations",
  "slugs",
  "seo",
  "created_at",
  "updated_at",
  "parent_property_id",
].join(", ");

const CARD_SELECT_COLUMNS = [
  "id",
  "legacy_code",
  "record_type",
  "project_business_type",
  "operation_type",
  "listing_type",
  "status",
  "price_sale",
  "price_rent_monthly",
  "price_currency",
  "property_data",
  "location",
  "features",
  "media",
  "translations",
  "slugs",
  "parent_property_id",
].join(", ");

const asRecord = (value: unknown): GenericRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as GenericRecord)
    : {};

const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const asBoolean = (value: unknown, fallback = false): boolean => {
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
  return fallback;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const normalizeFallbackProperties = (properties: PublicProperty[]) =>
  clone(properties).map((property) => normalizePm0074PublicProperty(property));

const loadFallbackProperties = async () => {
  if (fallbackPropertiesPromise) {
    return fallbackPropertiesPromise;
  }

  fallbackPropertiesPromise = import("@shared/data/properties").then((mod) =>
    normalizeFallbackProperties((mod.default ?? []) as PublicProperty[])
  );

  return fallbackPropertiesPromise;
};

const createFallbackLoader = (fallbackProperties?: PublicProperty[]): FallbackLoader => {
  let promise: Promise<PublicProperty[]> | null = null;

  return () => {
    if (promise) {
      return promise;
    }

    promise = fallbackProperties
      ? Promise.resolve(normalizeFallbackProperties(fallbackProperties))
      : loadFallbackProperties();

    return promise;
  };
};

const isListingType = (value: string | null): value is "promotion" | "unit" | "resale" | "rental" =>
  value === "promotion" || value === "unit" || value === "resale" || value === "rental";

const normalizeStringList = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
};

const normalizeListingTypes = (values: unknown): PublicListingType[] =>
  normalizeStringList(values).filter((value): value is PublicListingType => isListingType(value));

const normalizeLimit = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
};

const normalizePublicPropertiesQuery = (
  query?: PublicPropertiesQuery
): NormalizedPublicPropertiesQuery => ({
  ids: normalizeStringList(query?.ids),
  listingTypes: normalizeListingTypes(query?.listingTypes),
  statuses: normalizeStringList(query?.statuses),
  parentIds: normalizeStringList(query?.parentIds),
  onlyOwnProjects: query?.onlyOwnProjects === true,
  limit: normalizeLimit(query?.limit),
  slug: asText(query?.slug),
  slugLang: asText(query?.slugLang),
  countOnly: query?.countOnly === true,
  selectProfile: query?.selectProfile === "card" ? "card" : "full",
});

const toListingType = (row: GenericRecord) => {
  const listingType = asText(row.listing_type);
  if (isListingType(listingType)) return listingType;
  const recordType = asText(row.record_type);
  const operationType = asText(row.operation_type);
  if (recordType === "project") return "promotion";
  if (recordType === "unit") return "unit";
  if (operationType === "rent") return "rental";
  return "resale";
};

const toOperationType = (value: unknown): "sale" | "rent" | "both" => {
  if (value === "sale" || value === "rent" || value === "both") return value;
  return "sale";
};

const toStatus = (value: unknown) => {
  const status = asText(value);
  if (
    status === "draft" ||
    status === "available" ||
    status === "reserved" ||
    status === "sold" ||
    status === "rented" ||
    status === "private" ||
    status === "archived"
  ) {
    return status;
  }
  return "available";
};

const getPublicOrganizationId = () =>
  asText(import.meta.env.PUBLIC_CRM_ORGANIZATION_ID) ??
  asText(import.meta.env.CRM_ORGANIZATION_ID) ??
  null;

const allowAllOrganizations = () => import.meta.env.PUBLIC_CRM_ALLOW_ALL_ORGS === "true";
const OWN_PROJECT_BUSINESS_TYPE = "owned_and_commercialized";
const getPublicPropertiesCacheKey = (
  organizationId: string | null,
  query: NormalizedPublicPropertiesQuery
) => `${organizationId ?? "__all__"}::${JSON.stringify(query)}`;

const getLanguages = (translations: GenericRecord, slugs: GenericRecord) => {
  const keys = new Set<string>([
    ...Object.keys(translations),
    ...Object.keys(slugs),
  ]);
  const languages = Array.from(keys).filter((key) => key.trim().length > 0);
  return languages.length ? languages : ["es"];
};

const mapCrmRowToPublicProperty = (
  row: GenericRecord,
  parentLegacyCodeById: Map<string, string>
): PublicProperty | null => {
  const id = asText(row.id);
  const legacyCode = asText(row.legacy_code);
  if (!id || !legacyCode) return null;

  const operationType = toOperationType(row.operation_type);
  const salePrice = asNumber(row.price_sale);
  const rentPrice = asNumber(row.price_rent_monthly);
  const listingType = toListingType(row);
  const status = toStatus(row.status);

  const translations = asRecord(row.translations);
  const slugs = asRecord(row.slugs);
  const propertyData = asRecord(row.property_data);
  const location = asRecord(row.location);
  const media = asRecord(row.media);
  const seo = asRecord(row.seo);
  const parentId = asText(row.parent_property_id);
  const languages = getLanguages(translations, slugs);

  const parentLegacyCode = parentId ? parentLegacyCodeById.get(parentId) ?? null : null;
  const price =
    operationType === "rent"
      ? rentPrice
      : operationType === "both"
        ? salePrice ?? rentPrice
        : salePrice;

  const features = Array.isArray(row.features)
    ? row.features.filter((item): item is string => typeof item === "string")
    : [];

  return {
    id: legacyCode,
    crm_id: id,
    legacy_code: legacyCode,
    parent_id: parentLegacyCode,
    listing_type: listingType,
    record_type: asText(row.record_type) ?? "single",
    project_business_type: asText(row.project_business_type),
    is_own_project: asText(row.project_business_type) === OWN_PROJECT_BUSINESS_TYPE,
    status,
    featured: asBoolean(row.is_featured, false),
    is_public: asBoolean(row.is_public, true),
    languages,
    transaction: operationType,
    operation_type: operationType,
    price,
    pricing: {
      from: listingType === "promotion" ? salePrice : null,
      price_sale: salePrice,
      price_rent_monthly: rentPrice,
    },
    currency: asText(row.price_currency) ?? "EUR",
    location,
    property: propertyData,
    features,
    media,
    seo,
    slugs,
    translations,
    website_id: asText(row.website_id),
    priority: asNumber(propertyData.priority) ?? 0,
    created_at: asText(row.created_at),
    updated_at: asText(row.updated_at),
  };
};

const matchesPublicPropertiesQuery = (
  property: PublicProperty,
  query: NormalizedPublicPropertiesQuery
) => {
  const id = String(property.id ?? "").trim();
  const listingType = String(property.listing_type ?? "").trim();
  const status = String(property.status ?? "").trim();
  const parentId = String(property.parent_id ?? "").trim();
  const slugValue =
    query.slug && query.slugLang ? asText(asRecord(property.slugs)[query.slugLang]) : null;
  const isOwnProject =
    property.is_own_project === true ||
    property.project_business_type === OWN_PROJECT_BUSINESS_TYPE;

  if (query.ids.length > 0 && !query.ids.includes(id)) return false;
  if (query.listingTypes.length > 0 && !query.listingTypes.includes(listingType as PublicListingType)) {
    return false;
  }
  if (query.statuses.length > 0 && !query.statuses.includes(status)) return false;
  if (query.parentIds.length > 0 && !query.parentIds.includes(parentId)) return false;
  if (query.slug && query.slugLang && slugValue !== query.slug) return false;
  if (query.onlyOwnProjects && !isOwnProject) return false;
  return true;
};

const filterPublicPropertiesByQuery = (
  properties: PublicProperty[],
  query: NormalizedPublicPropertiesQuery
) => properties.filter((property) => matchesPublicPropertiesQuery(property, query));

const countPublicPropertiesQueryMatches = (
  properties: PublicProperty[],
  query: NormalizedPublicPropertiesQuery
) => filterPublicPropertiesByQuery(properties, query).length;

const applyPublicPropertiesQuery = (
  properties: PublicProperty[],
  query: NormalizedPublicPropertiesQuery
) => {
  const filtered = filterPublicPropertiesByQuery(properties, query);
  return query.limit ? filtered.slice(0, query.limit) : filtered;
};

const resolveParentCrmReferences = async (organizationId: string | null, parentIds: string[]) => {
  if (!parentIds.length) {
    return {
      ids: [] as string[],
      legacyCodeById: new Map<string, string>(),
    };
  }

  const client = getSupabaseServerClient();
  if (!client) {
    return {
      ids: [] as string[],
      legacyCodeById: new Map<string, string>(),
    };
  }

  let query = client
    .schema("crm")
    .from("properties")
    .select("id, legacy_code")
    .eq("is_public", true)
    .in("legacy_code", parentIds);

  if (organizationId) query = query.eq("organization_id", organizationId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const ids = Array.from(
    new Set(
      ((data ?? []) as GenericRecord[])
        .map((row) => asText(row.id))
        .filter((value): value is string => Boolean(value))
    )
  );
  const legacyCodeById = new Map<string, string>();
  ((data ?? []) as GenericRecord[]).forEach((row) => {
    const id = asText(row.id);
    const legacyCode = asText(row.legacy_code);
    if (id && legacyCode) {
      legacyCodeById.set(id, legacyCode);
    }
  });

  return { ids, legacyCodeById };
};

const applySupabasePublicPropertiesFilters = (
  query: any,
  organizationId: string | null,
  queryOptions: NormalizedPublicPropertiesQuery,
  parentCrmIds: string[]
) => {
  if (organizationId) query = query.eq("organization_id", organizationId);
  if (queryOptions.ids.length > 0) query = query.in("legacy_code", queryOptions.ids);
  if (queryOptions.listingTypes.length > 0) query = query.in("listing_type", queryOptions.listingTypes);
  if (queryOptions.statuses.length > 0) query = query.in("status", queryOptions.statuses);
  if (queryOptions.slug && queryOptions.slugLang) {
    query = query.contains("slugs", { [queryOptions.slugLang]: queryOptions.slug });
  }
  if (queryOptions.onlyOwnProjects) {
    query = query.eq("project_business_type", OWN_PROJECT_BUSINESS_TYPE);
  }
  if (parentCrmIds.length > 0) query = query.in("parent_property_id", parentCrmIds);
  return query;
};

const fetchPublicRowsCount = async (
  organizationId: string | null,
  queryOptions: NormalizedPublicPropertiesQuery
) => {
  const client = getSupabaseServerClient();
  if (!client) return 0;

  const parentCrmReferences = await resolveParentCrmReferences(organizationId, queryOptions.parentIds);
  if (queryOptions.parentIds.length > 0 && parentCrmReferences.ids.length === 0) {
    return 0;
  }

  let query = client
    .schema("crm")
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("is_public", true);

  query = applySupabasePublicPropertiesFilters(
    query,
    organizationId,
    queryOptions,
    parentCrmReferences.ids
  );

  const { count, error } = await query;
  if (error) throw new Error(error.message);

  return typeof count === "number" ? count : 0;
};

const fetchAllPublicRows = async (
  organizationId: string | null,
  queryOptions: NormalizedPublicPropertiesQuery
): Promise<{
  rows: GenericRecord[];
  parentLegacyCodeById: Map<string, string>;
}> => {
  const client = getSupabaseServerClient();
  if (!client) {
    return {
      rows: [],
      parentLegacyCodeById: new Map<string, string>(),
    };
  }

  const pageSize = 500;
  let from = 0;
  const rows: GenericRecord[] = [];
  const parentCrmReferences = await resolveParentCrmReferences(organizationId, queryOptions.parentIds);
  if (queryOptions.parentIds.length > 0 && parentCrmReferences.ids.length === 0) {
    return {
      rows: [],
      parentLegacyCodeById: parentCrmReferences.legacyCodeById,
    };
  }

  while (true) {
    let query = client
      .schema("crm")
      .from("properties")
      .select(queryOptions.selectProfile === "card" ? CARD_SELECT_COLUMNS : FULL_SELECT_COLUMNS)
      .eq("is_public", true)
      .order("updated_at", { ascending: false })
      .range(from, from + pageSize - 1);

    query = applySupabasePublicPropertiesFilters(
      query,
      organizationId,
      queryOptions,
      parentCrmReferences.ids
    );

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const batch = (data ?? []) as GenericRecord[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return {
    rows,
    parentLegacyCodeById: parentCrmReferences.legacyCodeById,
  };
};

const buildFallbackPublicPropertiesResult = async (
  fallbackLoader: FallbackLoader,
  queryOptions: NormalizedPublicPropertiesQuery,
  source: string
): Promise<PublicPropertiesResult> => {
  const fallbackProperties = await fallbackLoader();
  if (queryOptions.countOnly) {
    return {
      properties: [],
      source,
      count: countPublicPropertiesQueryMatches(fallbackProperties, queryOptions),
    };
  }

  return {
    properties: applyPublicPropertiesQuery(fallbackProperties, queryOptions),
    source,
    count: null,
  };
};

const resolvePublicProperties = async ({
  fallbackLoader,
  requestedOrgId,
  canQueryAllOrgs,
  queryOptions,
}: {
  fallbackLoader: FallbackLoader;
  requestedOrgId: string | null;
  canQueryAllOrgs: boolean;
  queryOptions: NormalizedPublicPropertiesQuery;
}): Promise<PublicPropertiesResult> => {
  if (!hasSupabaseServerClient()) {
    return buildFallbackPublicPropertiesResult(
      fallbackLoader,
      queryOptions,
      "fallback_json_no_supabase"
    );
  }

  if (!requestedOrgId && !canQueryAllOrgs) {
    return buildFallbackPublicPropertiesResult(
      fallbackLoader,
      queryOptions,
      "fallback_json_no_org_scope"
    );
  }

  try {
    if (queryOptions.countOnly) {
      const count = await fetchPublicRowsCount(requestedOrgId ?? null, queryOptions);
      if (count > 0) {
        return {
          properties: [],
          source: "supabase_crm_properties_count",
          count,
        };
      }

      return buildFallbackPublicPropertiesResult(
        fallbackLoader,
        queryOptions,
        "fallback_json_no_rows"
      );
    }

    const { rows, parentLegacyCodeById } = await fetchAllPublicRows(requestedOrgId ?? null, queryOptions);
    if (!rows.length) {
      return buildFallbackPublicPropertiesResult(
        fallbackLoader,
        queryOptions,
        "fallback_json_no_rows"
      );
    }

    rows.forEach((row) => {
      const id = asText(row.id);
      const legacyCode = asText(row.legacy_code);
      if (id && legacyCode) parentLegacyCodeById.set(id, legacyCode);
    });

    const mapped = applyPublicPropertiesQuery(
      rows
        .map((row) => mapCrmRowToPublicProperty(row, parentLegacyCodeById))
        .map((row) => (row ? normalizePm0074PublicProperty(row) : row))
        .filter((row): row is PublicProperty => Boolean(row))
        .sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? ""), undefined, { numeric: true })),
      queryOptions
    );

    if (!mapped.length) {
      return buildFallbackPublicPropertiesResult(
        fallbackLoader,
        queryOptions,
        "fallback_json_empty_mapping"
      );
    }

    return { properties: mapped, source: "supabase_crm_properties", count: null };
  } catch {
    return buildFallbackPublicPropertiesResult(
      fallbackLoader,
      queryOptions,
      "fallback_json_query_error"
    );
  }
};

export const getPublicPropertiesWithFallback = async (options: {
  fallbackProperties?: PublicProperty[];
  organizationId?: string | null;
  query?: PublicPropertiesQuery;
}) => {
  const requestedOrgId = asText(options.organizationId) ?? getPublicOrganizationId();
  const canQueryAllOrgs = allowAllOrganizations();
  const fallbackLoader = createFallbackLoader(options.fallbackProperties);
  const queryOptions = normalizePublicPropertiesQuery(options.query);

  const shouldUseCache = PUBLIC_PROPERTIES_CACHE_TTL_MS > 0 && !options.fallbackProperties;
  if (!shouldUseCache) {
    return resolvePublicProperties({
      fallbackLoader,
      requestedOrgId,
      canQueryAllOrgs,
      queryOptions,
    });
  }

  const cacheKey = getPublicPropertiesCacheKey(requestedOrgId ?? null, queryOptions);
  const now = Date.now();
  const cached = publicPropertiesCache.get(cacheKey);

  if (cached?.value && cached.expiresAt > now) {
    return cached.value;
  }

  if (cached?.promise) {
    return cached.promise;
  }

  const promise = resolvePublicProperties({
    fallbackLoader,
    requestedOrgId,
    canQueryAllOrgs,
    queryOptions,
  })
    .then((result) => {
      publicPropertiesCache.set(cacheKey, {
        expiresAt: Date.now() + PUBLIC_PROPERTIES_CACHE_TTL_MS,
        value: result,
        promise: null,
      });
      return result;
    })
    .catch((error) => {
      publicPropertiesCache.delete(cacheKey);
      throw error;
    });

  publicPropertiesCache.set(cacheKey, {
    expiresAt: cached?.expiresAt ?? 0,
    value: cached?.value ?? null,
    promise,
  });

  return promise;
};
