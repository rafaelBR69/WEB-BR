import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";
import { ensurePropertyStorageScaffold } from "@/utils/crmPropertyStorage";
import {
  type OperationType,
  type ProjectBusinessType,
  type PropertyRecordType,
  type PropertyStatus,
  mapPropertyRow,
  mergeOperationalData,
  normalizeOperationType,
  normalizeProjectBusinessType,
  normalizePropertyStatus,
  normalizeRecordType,
} from "@/utils/crmProperties";
import {
  findMockPropertyByLegacyCode,
  insertMockPropertyRow,
  listMockPropertyRows,
} from "@/utils/crmMockPropertyStore";

type CreatePropertyBody = {
  organization_id?: string;
  legacy_code?: string;
  record_type?: PropertyRecordType;
  project_business_type?: ProjectBusinessType;
  operation_type?: OperationType;
  status?: PropertyStatus;
  parent_legacy_code?: string;
  price_sale?: number | null;
  price_rent_monthly?: number | null;
  currency?: string;
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
  rent_price_on_request?: boolean;
  is_featured?: boolean;
  is_public?: boolean;
  commercialization_notes?: string | null;
};

type PropertySummaryRow = {
  id: string | null;
  legacy_code: string | null;
  display_name: string | null;
  project_name: string | null;
  record_type: PropertyRecordType;
  project_business_type: ProjectBusinessType;
  status: PropertyStatus;
  parent_property_id: string | null;
};

type PropertyFilter = {
  organizationId: string | null;
  operation: OperationType | null;
  recordType: PropertyRecordType | null;
  projectBusinessType: ProjectBusinessType | null;
  status: PropertyStatus | null;
  q: string;
  projectId: string | null;
};

const SELECT_COLUMNS = [
  "id",
  "organization_id",
  "website_id",
  "legacy_code",
  "translations",
  "record_type",
  "project_business_type",
  "commercialization_notes",
  "parent_property_id",
  "operation_type",
  "status",
  "is_featured",
  "is_public",
  "price_sale",
  "price_rent_monthly",
  "price_currency",
  "property_data",
  "location",
  "media",
  "created_at",
  "updated_at",
].join(", ");

const PROPERTY_STATUSES: PropertyStatus[] = [
  "draft",
  "available",
  "reserved",
  "sold",
  "rented",
  "private",
  "archived",
];

const PROPERTY_RECORD_TYPES: PropertyRecordType[] = ["project", "unit", "single"];
const PROJECT_BUSINESS_TYPES: ProjectBusinessType[] = [
  "owned_and_commercialized",
  "provider_and_commercialized_by_us",
  "external_listing",
];

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
};

const toBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.toLowerCase().trim();
    if (lower === "true" || lower === "1" || lower === "yes") return true;
    if (lower === "false" || lower === "0" || lower === "no") return false;
  }
  return fallback;
};

const toOptionalText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const asOrganizationId = (value: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const asUuidOrNull = (value: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  return UUID_RX.test(trimmed) ? trimmed : null;
};

const toPositiveInt = (value: string | null, fallback: number, min: number, max: number) => {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  const int = Math.floor(raw);
  if (int < min) return min;
  if (int > max) return max;
  return int;
};

const parseBooleanFlag = (value: string | null) => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const normalizeFilterTerm = (value: string) =>
  value
    .replaceAll("%", " ")
    .replaceAll(",", " ")
    .replaceAll("(", " ")
    .replaceAll(")", " ")
    .replaceAll('"', " ")
    .trim();

const emptyCounter = <T extends string>(keys: readonly T[]) =>
  keys.reduce<Record<T, number>>((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {} as Record<T, number>);

const parseFilterParams = (url: URL): PropertyFilter => {
  const operationParam = url.searchParams.get("operation");
  const recordTypeParam = url.searchParams.get("record_type");
  const projectBusinessTypeParam = url.searchParams.get("project_business_type");
  const statusParam = url.searchParams.get("status");
  const projectId = asUuidOrNull(url.searchParams.get("project_id"));

  return {
    organizationId: asOrganizationId(url.searchParams.get("organization_id")),
    operation:
      operationParam === "sale" || operationParam === "rent" || operationParam === "both"
        ? operationParam
        : null,
    recordType:
      recordTypeParam === "project" || recordTypeParam === "unit" || recordTypeParam === "single"
        ? recordTypeParam
        : null,
    projectBusinessType:
      projectBusinessTypeParam === "owned_and_commercialized" ||
      projectBusinessTypeParam === "provider_and_commercialized_by_us" ||
      projectBusinessTypeParam === "external_listing"
        ? projectBusinessTypeParam
        : null,
    status:
      statusParam === "draft" ||
      statusParam === "available" ||
      statusParam === "reserved" ||
      statusParam === "sold" ||
      statusParam === "rented" ||
      statusParam === "private" ||
      statusParam === "archived"
        ? statusParam
        : null,
    q: url.searchParams.get("q")?.trim().toLowerCase() ?? "",
    projectId,
  };
};

const toSummaryRow = (row: Record<string, unknown>): PropertySummaryRow => {
  const mapped = mapPropertyRow(row);
  return {
    id: toOptionalText(mapped.id),
    legacy_code: mapped.legacy_code,
    display_name: mapped.display_name,
    project_name: mapped.project_name,
    record_type: mapped.record_type,
    project_business_type: mapped.project_business_type,
    status: mapped.status,
    parent_property_id: toOptionalText(mapped.parent_property_id),
  };
};

const buildStats = (rows: PropertySummaryRow[]) => {
  const byStatus = emptyCounter(PROPERTY_STATUSES);
  const byRecordType = emptyCounter(PROPERTY_RECORD_TYPES);
  const byBusinessType = emptyCounter(PROJECT_BUSINESS_TYPES);

  const projectsById = new Map<
    string,
    {
      id: string;
      legacy_code: string | null;
      display_name: string | null;
      project_name: string | null;
      status: PropertyStatus;
      business_type: ProjectBusinessType;
      total_units: number;
      available_units: number;
      reserved_units: number;
      sold_units: number;
      rented_units: number;
      draft_units: number;
    }
  >();

  rows.forEach((row) => {
    byStatus[row.status] += 1;
    byRecordType[row.record_type] += 1;
    byBusinessType[row.project_business_type] += 1;
    if (row.record_type === "project" && row.id) {
      projectsById.set(row.id, {
        id: row.id,
        legacy_code: row.legacy_code,
        display_name: row.display_name,
        project_name: row.project_name,
        status: row.status,
        business_type: row.project_business_type,
        total_units: 0,
        available_units: 0,
        reserved_units: 0,
        sold_units: 0,
        rented_units: 0,
        draft_units: 0,
      });
    }
  });

  rows.forEach((row) => {
    if (row.record_type !== "unit" || !row.parent_property_id) return;
    const project = projectsById.get(row.parent_property_id);
    if (!project) return;
    project.total_units += 1;
    if (row.status === "available") project.available_units += 1;
    if (row.status === "reserved") project.reserved_units += 1;
    if (row.status === "sold") project.sold_units += 1;
    if (row.status === "rented") project.rented_units += 1;
    if (row.status === "draft") project.draft_units += 1;
  });

  const promotions = Array.from(projectsById.values()).sort((a, b) => {
    if (a.available_units !== b.available_units) return b.available_units - a.available_units;
    if (a.total_units !== b.total_units) return b.total_units - a.total_units;
    const labelA = a.project_name ?? a.display_name ?? a.legacy_code ?? "";
    const labelB = b.project_name ?? b.display_name ?? b.legacy_code ?? "";
    return String(labelA).localeCompare(String(labelB));
  });

  return {
    total: rows.length,
    available_total: byStatus.available,
    projects_total: byRecordType.project,
    units_total: byRecordType.unit,
    singles_total: byRecordType.single,
    by_status: byStatus,
    by_record_type: byRecordType,
    by_business_type: byBusinessType,
    promotions,
  };
};

const applySupabaseFilters = (query: any, filters: PropertyFilter) => {
  let next = query;
  const orFilters: string[] = [];
  if (filters.organizationId) next = next.eq("organization_id", filters.organizationId);
  if (filters.operation) next = next.eq("operation_type", filters.operation);
  if (filters.recordType) next = next.eq("record_type", filters.recordType);
  if (filters.projectBusinessType) {
    next = next.eq("project_business_type", filters.projectBusinessType);
  }
  if (filters.status) next = next.eq("status", filters.status);
  if (filters.q) {
    const term = normalizeFilterTerm(filters.q);
    if (term) {
      orFilters.push(
        `legacy_code.ilike.%${term}%`,
        `translations->es->>title.ilike.%${term}%`,
        `translations->en->>title.ilike.%${term}%`
      );
    }
  }
  if (filters.projectId) {
    orFilters.push(`id.eq.${filters.projectId}`, `parent_property_id.eq.${filters.projectId}`);
  }
  if (orFilters.length) {
    next = next.or(orFilters.join(","));
  }
  return next;
};

const applyMappedFilters = (
  items: ReturnType<typeof mapPropertyRow>[],
  filters: PropertyFilter
) =>
  items
    .filter((item) => (filters.organizationId ? item.organization_id === filters.organizationId : true))
    .filter((item) => (filters.operation ? item.operation_type === filters.operation : true))
    .filter((item) => (filters.recordType ? item.record_type === filters.recordType : true))
    .filter((item) =>
      filters.projectBusinessType ? item.project_business_type === filters.projectBusinessType : true
    )
    .filter((item) => (filters.status ? item.status === filters.status : true))
    .filter((item) =>
      filters.projectId
        ? item.id === filters.projectId || item.parent_property_id === filters.projectId
        : true
    )
    .filter((item) =>
      filters.q
        ? [item.legacy_code, item.display_name, item.project_name]
            .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
            .some((entry) => entry.toLowerCase().includes(filters.q))
        : true
    );

const resolveParentPropertyId = async (
  organizationId: string,
  parentLegacyCode: string
): Promise<{ id: string | null; error: string | null }> => {
  if (!hasSupabaseServerClient()) {
    const row = findMockPropertyByLegacyCode(organizationId, parentLegacyCode);
    if (!row) return { id: null, error: "parent_property_not_found" };
    return { id: String(row.id), error: null };
  }

  const client = getSupabaseServerClient();
  if (!client) return { id: null, error: "supabase_not_configured" };

  const { data, error } = await client
    .schema("crm")
    .from("properties")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("legacy_code", parentLegacyCode)
    .maybeSingle();

  if (error) return { id: null, error: error.message };
  if (!data?.id) return { id: null, error: "parent_property_not_found" };
  return { id: String(data.id), error: null };
};

export const GET: APIRoute = async ({ url }) => {
  const filters = parseFilterParams(url);
  const includeStats = parseBooleanFlag(url.searchParams.get("include_stats"));
  const requestedPage = toPositiveInt(url.searchParams.get("page"), 1, 1, 10000);
  const perPage = toPositiveInt(url.searchParams.get("per_page"), 24, 1, 200);

  if (!hasSupabaseServerClient()) {
    const allFiltered = applyMappedFilters(
      listMockPropertyRows().map((row) => mapPropertyRow(row)),
      filters
    );

    const total = allFiltered.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(requestedPage, totalPages);
    const from = (page - 1) * perPage;
    const to = from + perPage;
    const data = allFiltered.slice(from, to);
    const summaryRows = allFiltered.map((row) =>
      toSummaryRow({
        id: row.id,
        legacy_code: row.legacy_code,
        display_name: row.display_name,
        project_name: row.project_name,
        record_type: row.record_type,
        project_business_type: row.project_business_type,
        status: row.status,
        parent_property_id: row.parent_property_id,
      })
    );

    return jsonResponse({
      ok: true,
      data,
      meta: {
        count: data.length,
        total,
        page,
        per_page: perPage,
        total_pages: totalPages,
        storage: "mock_in_memory",
        supports: {
          operation_type: ["sale", "rent", "both"],
          record_type: ["project", "unit", "single"],
          project_business_type: [
            "owned_and_commercialized",
            "provider_and_commercialized_by_us",
            "external_listing",
          ],
        },
        next_step: "set_SUPABASE_URL_and_SUPABASE_SERVICE_ROLE_KEY",
        ...(includeStats ? { stats: buildStats(summaryRows) } : {}),
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) {
    return jsonResponse(
      {
        ok: false,
        error: "supabase_not_configured",
      },
      { status: 500 }
    );
  }

  const runPagedQuery = async (page: number) => {
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;
    const base = client
      .schema("crm")
      .from("properties")
      .select(SELECT_COLUMNS, { count: "exact" })
      .order("updated_at", { ascending: false })
      .range(from, to);
    return applySupabaseFilters(base, filters);
  };

  let page = requestedPage;
  let { data, error, count } = await runPagedQuery(page);

  if (!error && typeof count === "number") {
    const totalPages = Math.max(1, Math.ceil(count / perPage));
    if (page > totalPages) {
      page = totalPages;
      const rerun = await runPagedQuery(page);
      data = rerun.data;
      error = rerun.error;
      count = rerun.count;
    }
  }

  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_read_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  let statsPayload: ReturnType<typeof buildStats> | null = null;
  if (includeStats) {
    const statsQuery = applySupabaseFilters(
      client
        .schema("crm")
        .from("properties")
        .select(
          "id, legacy_code, translations, record_type, project_business_type, status, parent_property_id"
        ),
      filters
    );
    const { data: statsRows, error: statsError } = await statsQuery;
    if (statsError) {
      return jsonResponse(
        {
          ok: false,
          error: "db_stats_error",
          details: statsError.message,
        },
        { status: 500 }
      );
    }
    statsPayload = (statsRows ?? []).map((row) => toSummaryRow(row as Record<string, unknown>));
  }

  const total = typeof count === "number" ? count : (data ?? []).length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const mapped = (data ?? []).map((row) => mapPropertyRow(row as Record<string, unknown>));
  return jsonResponse({
    ok: true,
    data: mapped,
    meta: {
      count: mapped.length,
      total,
      page,
      per_page: perPage,
      total_pages: totalPages,
      storage: "supabase.crm.properties",
      ...(statsPayload ? { stats: buildStats(statsPayload) } : {}),
    },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<CreatePropertyBody>(request);
  if (!body) {
    return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });
  }

  const organizationId = toOptionalText(body.organization_id);
  const legacyCode = toOptionalText(body.legacy_code);

  if (!organizationId) {
    return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  }
  if (!legacyCode) {
    return jsonResponse({ ok: false, error: "legacy_code_required" }, { status: 422 });
  }

  const recordType = normalizeRecordType(body.record_type);
  const operationType = normalizeOperationType(body.operation_type);
  const projectBusinessType = normalizeProjectBusinessType(body.project_business_type);
  const status = normalizePropertyStatus(body.status);
  const currency = toOptionalText(body.currency) ?? "EUR";

  let parentPropertyId: string | null = null;
  const parentLegacyCode = toOptionalText(body.parent_legacy_code);
  if (recordType === "unit" && !parentLegacyCode) {
    return jsonResponse(
      {
        ok: false,
        error: "parent_legacy_code_required_for_unit",
      },
      { status: 422 }
    );
  }

  if (recordType === "unit" && parentLegacyCode) {
    const parentResult = await resolveParentPropertyId(organizationId, parentLegacyCode);
    if (parentResult.error || !parentResult.id) {
      return jsonResponse(
        {
          ok: false,
          error: "parent_property_not_found",
          details: parentResult.error,
        },
        { status: 422 }
      );
    }
    parentPropertyId = parentResult.id;
  }

  const propertyData = mergeOperationalData(
    {},
    {
      area_m2: toNumberOrNull(body.area_m2),
      usable_area_m2: toNumberOrNull(body.usable_area_m2),
      built_area_total_m2: toNumberOrNull(body.built_area_total_m2),
      terrace_m2: toNumberOrNull(body.terrace_m2),
      exterior_area_m2: toNumberOrNull(body.exterior_area_m2),
      garden_m2: toNumberOrNull(body.garden_m2),
      plot_m2: toNumberOrNull(body.plot_m2),
      bedrooms: toNumberOrNull(body.bedrooms),
      bathrooms: toNumberOrNull(body.bathrooms),
      garages: toNumberOrNull(body.garages),
      storage_rooms: toNumberOrNull(body.storage_rooms),
      floor_level: toNumberOrNull(body.floor_level),
      year_built: toNumberOrNull(body.year_built),
      community_fees_monthly: toNumberOrNull(body.community_fees_monthly),
      ibi_yearly: toNumberOrNull(body.ibi_yearly),
      floor_label: toOptionalText(body.floor_label),
      building_block: toOptionalText(body.building_block),
      building_portal: toOptionalText(body.building_portal),
      building_door: toOptionalText(body.building_door),
      building_name: toOptionalText(body.building_name),
      orientation: toOptionalText(body.orientation),
      condition: toOptionalText(body.condition),
      cadastral_ref: toOptionalText(body.cadastral_ref),
      energy_rating: toOptionalText(body.energy_rating),
      elevator: body.elevator === undefined ? undefined : toBoolean(body.elevator, false),
      rent_price_on_request: body.rent_price_on_request ?? false,
    }
  );

  if (!hasSupabaseServerClient()) {
    const inserted = insertMockPropertyRow({
      organization_id: organizationId,
      website_id: null,
      legacy_code: legacyCode,
      record_type: recordType,
      project_business_type: projectBusinessType,
      commercialization_notes: toOptionalText(body.commercialization_notes),
      parent_property_id: parentPropertyId,
      operation_type: operationType,
      status,
      is_featured: toBoolean(body.is_featured),
      is_public: toBoolean(body.is_public, true),
      price_sale: toNumberOrNull(body.price_sale),
      price_rent_monthly: toNumberOrNull(body.price_rent_monthly),
      price_currency: currency,
      property_data: propertyData,
      location: {},
      media: {
        cover: null,
        gallery: {},
      },
    });

    return jsonResponse(
      {
        ok: true,
        data: mapPropertyRow(inserted),
        meta: {
          persisted: true,
          storage: "mock_in_memory",
        },
      },
      { status: 201 }
    );
  }

  const client = getSupabaseServerClient();
  if (!client) {
    return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });
  }

  const propertyId = crypto.randomUUID();
  try {
    await ensurePropertyStorageScaffold(client, organizationId, propertyId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "storage_scaffold_failed";
    return jsonResponse(
      {
        ok: false,
        error: "storage_scaffold_failed",
        details: detail,
      },
      { status: 500 }
    );
  }

  const insertPayload = {
    id: propertyId,
    organization_id: organizationId,
    legacy_code: legacyCode,
    record_type: recordType,
    project_business_type: projectBusinessType,
    operation_type: operationType,
    parent_property_id: parentPropertyId,
    status,
    price_sale: toNumberOrNull(body.price_sale),
    price_rent_monthly: toNumberOrNull(body.price_rent_monthly),
    price_currency: currency,
    property_data: propertyData,
    media: {
      cover: null,
      gallery: {},
    },
    commercialization_notes: toOptionalText(body.commercialization_notes),
    is_featured: toBoolean(body.is_featured),
    is_public: toBoolean(body.is_public, true),
  };

  const { data, error } = await client
    .schema("crm")
    .from("properties")
    .insert(insertPayload)
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_insert_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  return jsonResponse(
    {
      ok: true,
      data: mapPropertyRow(data as Record<string, unknown>),
      meta: {
        persisted: true,
        storage: "supabase.crm.properties",
      },
    },
    { status: 201 }
  );
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
