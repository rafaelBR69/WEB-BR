import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";

type GenericRecord = Record<string, unknown>;
type PublicProperty = Record<string, unknown>;

const SELECT_COLUMNS = [
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

const isListingType = (value: string | null): value is "promotion" | "unit" | "resale" | "rental" =>
  value === "promotion" || value === "unit" || value === "resale" || value === "rental";

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
    is_own_project: asText(row.project_business_type) === "owned_and_commercialized",
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

const fetchAllPublicRows = async (organizationId: string | null): Promise<GenericRecord[]> => {
  const client = getSupabaseServerClient();
  if (!client) return [];

  const pageSize = 500;
  let from = 0;
  const rows: GenericRecord[] = [];

  while (true) {
    let query = client
      .schema("crm")
      .from("properties")
      .select(SELECT_COLUMNS)
      .eq("is_public", true)
      .order("updated_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (organizationId) query = query.eq("organization_id", organizationId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const batch = (data ?? []) as GenericRecord[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return rows;
};

export const getPublicPropertiesWithFallback = async (options: {
  fallbackProperties: PublicProperty[];
  organizationId?: string | null;
}) => {
  const fallback = clone(options.fallbackProperties);
  const requestedOrgId = asText(options.organizationId) ?? getPublicOrganizationId();
  const canQueryAllOrgs = allowAllOrganizations();

  if (!hasSupabaseServerClient()) {
    return { properties: fallback, source: "fallback_json_no_supabase" as const };
  }

  if (!requestedOrgId && !canQueryAllOrgs) {
    return { properties: fallback, source: "fallback_json_no_org_scope" as const };
  }

  try {
    const rows = await fetchAllPublicRows(requestedOrgId ?? null);
    if (!rows.length) {
      return { properties: fallback, source: "fallback_json_no_rows" as const };
    }

    const parentLegacyCodeById = new Map<string, string>();
    rows.forEach((row) => {
      const id = asText(row.id);
      const legacyCode = asText(row.legacy_code);
      if (id && legacyCode) parentLegacyCodeById.set(id, legacyCode);
    });

    const mapped = rows
      .map((row) => mapCrmRowToPublicProperty(row, parentLegacyCodeById))
      .filter((row): row is PublicProperty => Boolean(row))
      .sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? ""), undefined, { numeric: true }));

    if (!mapped.length) {
      return { properties: fallback, source: "fallback_json_empty_mapping" as const };
    }

    return { properties: mapped, source: "supabase_crm_properties" as const };
  } catch {
    return { properties: fallback, source: "fallback_json_query_error" as const };
  }
};

