import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";
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
  getMockPropertyRowById,
  patchMockPropertyRow,
} from "@/utils/crmMockPropertyStore";

type UpdatePropertyBody = {
  organization_id?: string;
  legacy_code?: string;
  record_type?: PropertyRecordType;
  project_business_type?: ProjectBusinessType;
  operation_type?: OperationType;
  status?: PropertyStatus;
  parent_legacy_code?: string | null;
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
  status_note?: string | null;
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

const hasOwn = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key);

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

const getPropertyIdFromParams = (params: Record<string, string | undefined>): string | null => {
  const raw = params.id;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
};

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

const insertStatusHistory = async (payload: {
  organization_id: string;
  property_id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
}) => {
  const client = getSupabaseServerClient();
  if (!client) return;
  await client.schema("crm").from("property_status_history").insert(payload);
};

export const GET: APIRoute = async ({ params, url }) => {
  const id = getPropertyIdFromParams(params);
  if (!id) {
    return jsonResponse({ ok: false, error: "property_id_required" }, { status: 400 });
  }

  const organizationId = toOptionalText(url.searchParams.get("organization_id"));

  if (!hasSupabaseServerClient()) {
    const row = getMockPropertyRowById(id);
    if (!row) return jsonResponse({ ok: false, error: "property_not_found" }, { status: 404 });
    if (organizationId && row.organization_id !== organizationId) {
      return jsonResponse({ ok: false, error: "property_not_found" }, { status: 404 });
    }
    return jsonResponse({
      ok: true,
      data: mapPropertyRow(row),
      meta: {
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  let query = client.schema("crm").from("properties").select(SELECT_COLUMNS).eq("id", id).maybeSingle();
  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query;
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
  if (!data) return jsonResponse({ ok: false, error: "property_not_found" }, { status: 404 });

  return jsonResponse({
    ok: true,
    data: mapPropertyRow(data as Record<string, unknown>),
    meta: {
      storage: "supabase.crm.properties",
    },
  });
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = getPropertyIdFromParams(params);
  if (!id) {
    return jsonResponse({ ok: false, error: "property_id_required" }, { status: 400 });
  }

  const body = await parseJsonBody<UpdatePropertyBody>(request);
  if (!body) {
    return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });
  }

  if (!hasSupabaseServerClient()) {
    const current = getMockPropertyRowById(id);
    if (!current) return jsonResponse({ ok: false, error: "property_not_found" }, { status: 404 });

    const patch: Record<string, unknown> = {};

    if (hasOwn(body, "legacy_code")) {
      const legacyCode = toOptionalText(body.legacy_code);
      if (!legacyCode) return jsonResponse({ ok: false, error: "legacy_code_required" }, { status: 422 });
      patch.legacy_code = legacyCode;
    }
    if (hasOwn(body, "record_type")) patch.record_type = normalizeRecordType(body.record_type);
    if (hasOwn(body, "operation_type")) patch.operation_type = normalizeOperationType(body.operation_type);
    if (hasOwn(body, "project_business_type")) {
      patch.project_business_type = normalizeProjectBusinessType(body.project_business_type);
    }
    if (hasOwn(body, "status")) patch.status = normalizePropertyStatus(body.status);
    if (hasOwn(body, "price_sale")) patch.price_sale = toNumberOrNull(body.price_sale);
    if (hasOwn(body, "price_rent_monthly")) patch.price_rent_monthly = toNumberOrNull(body.price_rent_monthly);
    if (hasOwn(body, "currency")) patch.price_currency = toOptionalText(body.currency) ?? current.price_currency;
    if (hasOwn(body, "is_featured")) patch.is_featured = toBoolean(body.is_featured, current.is_featured);
    if (hasOwn(body, "is_public")) patch.is_public = toBoolean(body.is_public, current.is_public);
    if (hasOwn(body, "commercialization_notes")) {
      patch.commercialization_notes = toOptionalText(body.commercialization_notes);
    }

    if (hasOwn(body, "parent_legacy_code")) {
      const parentLegacyCode = toOptionalText(body.parent_legacy_code);
      if (!parentLegacyCode) {
        patch.parent_property_id = null;
      } else {
        const resolved = findMockPropertyByLegacyCode(current.organization_id, parentLegacyCode);
        if (!resolved?.id) {
          return jsonResponse({ ok: false, error: "parent_property_not_found" }, { status: 422 });
        }
        patch.parent_property_id = resolved.id;
      }
    }

    const hasOperationalPatch =
      hasOwn(body, "area_m2") ||
      hasOwn(body, "usable_area_m2") ||
      hasOwn(body, "built_area_total_m2") ||
      hasOwn(body, "terrace_m2") ||
      hasOwn(body, "exterior_area_m2") ||
      hasOwn(body, "garden_m2") ||
      hasOwn(body, "plot_m2") ||
      hasOwn(body, "bedrooms") ||
      hasOwn(body, "bathrooms") ||
      hasOwn(body, "garages") ||
      hasOwn(body, "storage_rooms") ||
      hasOwn(body, "floor_level") ||
      hasOwn(body, "year_built") ||
      hasOwn(body, "community_fees_monthly") ||
      hasOwn(body, "ibi_yearly") ||
      hasOwn(body, "floor_label") ||
      hasOwn(body, "building_block") ||
      hasOwn(body, "building_portal") ||
      hasOwn(body, "building_door") ||
      hasOwn(body, "building_name") ||
      hasOwn(body, "orientation") ||
      hasOwn(body, "condition") ||
      hasOwn(body, "cadastral_ref") ||
      hasOwn(body, "energy_rating") ||
      hasOwn(body, "elevator") ||
      hasOwn(body, "rent_price_on_request");

    if (hasOperationalPatch) {
      patch.property_data = mergeOperationalData(current.property_data, {
        area_m2: hasOwn(body, "area_m2") ? toNumberOrNull(body.area_m2) : undefined,
        usable_area_m2: hasOwn(body, "usable_area_m2")
          ? toNumberOrNull(body.usable_area_m2)
          : undefined,
        built_area_total_m2: hasOwn(body, "built_area_total_m2")
          ? toNumberOrNull(body.built_area_total_m2)
          : undefined,
        terrace_m2: hasOwn(body, "terrace_m2") ? toNumberOrNull(body.terrace_m2) : undefined,
        exterior_area_m2: hasOwn(body, "exterior_area_m2")
          ? toNumberOrNull(body.exterior_area_m2)
          : undefined,
        garden_m2: hasOwn(body, "garden_m2") ? toNumberOrNull(body.garden_m2) : undefined,
        plot_m2: hasOwn(body, "plot_m2") ? toNumberOrNull(body.plot_m2) : undefined,
        bedrooms: hasOwn(body, "bedrooms") ? toNumberOrNull(body.bedrooms) : undefined,
        bathrooms: hasOwn(body, "bathrooms") ? toNumberOrNull(body.bathrooms) : undefined,
        garages: hasOwn(body, "garages") ? toNumberOrNull(body.garages) : undefined,
        storage_rooms: hasOwn(body, "storage_rooms") ? toNumberOrNull(body.storage_rooms) : undefined,
        floor_level: hasOwn(body, "floor_level") ? toNumberOrNull(body.floor_level) : undefined,
        year_built: hasOwn(body, "year_built") ? toNumberOrNull(body.year_built) : undefined,
        community_fees_monthly: hasOwn(body, "community_fees_monthly")
          ? toNumberOrNull(body.community_fees_monthly)
          : undefined,
        ibi_yearly: hasOwn(body, "ibi_yearly") ? toNumberOrNull(body.ibi_yearly) : undefined,
        floor_label: hasOwn(body, "floor_label") ? toOptionalText(body.floor_label) : undefined,
        building_block: hasOwn(body, "building_block")
          ? toOptionalText(body.building_block)
          : undefined,
        building_portal: hasOwn(body, "building_portal")
          ? toOptionalText(body.building_portal)
          : undefined,
        building_door: hasOwn(body, "building_door") ? toOptionalText(body.building_door) : undefined,
        building_name: hasOwn(body, "building_name") ? toOptionalText(body.building_name) : undefined,
        orientation: hasOwn(body, "orientation") ? toOptionalText(body.orientation) : undefined,
        condition: hasOwn(body, "condition") ? toOptionalText(body.condition) : undefined,
        cadastral_ref: hasOwn(body, "cadastral_ref") ? toOptionalText(body.cadastral_ref) : undefined,
        energy_rating: hasOwn(body, "energy_rating") ? toOptionalText(body.energy_rating) : undefined,
        elevator: hasOwn(body, "elevator") ? toBoolean(body.elevator, false) : undefined,
        rent_price_on_request: hasOwn(body, "rent_price_on_request")
          ? toBoolean(body.rent_price_on_request, false)
          : undefined,
      });
    }

    const next = patchMockPropertyRow(id, patch);
    if (!next) return jsonResponse({ ok: false, error: "property_not_found" }, { status: 404 });

    return jsonResponse({
      ok: true,
      data: mapPropertyRow(next),
      meta: {
        storage: "mock_in_memory",
        persisted: true,
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  let currentQuery = client
    .schema("crm")
    .from("properties")
    .select("id, organization_id, status, property_data, is_featured, is_public, price_currency")
    .eq("id", id)
    .maybeSingle();

  const organizationIdForScope = toOptionalText(body.organization_id);
  if (organizationIdForScope) {
    currentQuery = currentQuery.eq("organization_id", organizationIdForScope);
  }

  const { data: current, error: currentError } = await currentQuery;
  if (currentError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_read_error",
        details: currentError.message,
      },
      { status: 500 }
    );
  }
  if (!current) return jsonResponse({ ok: false, error: "property_not_found" }, { status: 404 });

  const organizationId = String(current.organization_id);
  const updatePayload: Record<string, unknown> = {};

  if (hasOwn(body, "legacy_code")) {
    const legacyCode = toOptionalText(body.legacy_code);
    if (!legacyCode) return jsonResponse({ ok: false, error: "legacy_code_required" }, { status: 422 });
    updatePayload.legacy_code = legacyCode;
  }
  if (hasOwn(body, "record_type")) updatePayload.record_type = normalizeRecordType(body.record_type);
  if (hasOwn(body, "operation_type")) updatePayload.operation_type = normalizeOperationType(body.operation_type);
  if (hasOwn(body, "project_business_type")) {
    updatePayload.project_business_type = normalizeProjectBusinessType(body.project_business_type);
  }
  if (hasOwn(body, "status")) updatePayload.status = normalizePropertyStatus(body.status);
  if (hasOwn(body, "price_sale")) updatePayload.price_sale = toNumberOrNull(body.price_sale);
  if (hasOwn(body, "price_rent_monthly")) updatePayload.price_rent_monthly = toNumberOrNull(body.price_rent_monthly);
  if (hasOwn(body, "currency")) {
    updatePayload.price_currency = toOptionalText(body.currency) ?? String(current.price_currency ?? "EUR");
  }
  if (hasOwn(body, "is_featured")) {
    updatePayload.is_featured = toBoolean(body.is_featured, Boolean(current.is_featured));
  }
  if (hasOwn(body, "is_public")) {
    updatePayload.is_public = toBoolean(body.is_public, current.is_public !== false);
  }
  if (hasOwn(body, "commercialization_notes")) {
    updatePayload.commercialization_notes = toOptionalText(body.commercialization_notes);
  }

  if (hasOwn(body, "parent_legacy_code")) {
    const parentLegacyCode = toOptionalText(body.parent_legacy_code);
    if (!parentLegacyCode) {
      updatePayload.parent_property_id = null;
    } else {
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
      updatePayload.parent_property_id = parentResult.id;
    }
  }

  const hasOperationalPatch =
    hasOwn(body, "area_m2") ||
    hasOwn(body, "usable_area_m2") ||
    hasOwn(body, "built_area_total_m2") ||
    hasOwn(body, "terrace_m2") ||
    hasOwn(body, "exterior_area_m2") ||
    hasOwn(body, "garden_m2") ||
    hasOwn(body, "plot_m2") ||
    hasOwn(body, "bedrooms") ||
    hasOwn(body, "bathrooms") ||
    hasOwn(body, "garages") ||
    hasOwn(body, "storage_rooms") ||
    hasOwn(body, "floor_level") ||
    hasOwn(body, "year_built") ||
    hasOwn(body, "community_fees_monthly") ||
    hasOwn(body, "ibi_yearly") ||
    hasOwn(body, "floor_label") ||
    hasOwn(body, "building_block") ||
    hasOwn(body, "building_portal") ||
    hasOwn(body, "building_door") ||
    hasOwn(body, "building_name") ||
    hasOwn(body, "orientation") ||
    hasOwn(body, "condition") ||
    hasOwn(body, "cadastral_ref") ||
    hasOwn(body, "energy_rating") ||
    hasOwn(body, "elevator") ||
    hasOwn(body, "rent_price_on_request");

  if (hasOperationalPatch) {
    updatePayload.property_data = mergeOperationalData(current.property_data, {
      area_m2: hasOwn(body, "area_m2") ? toNumberOrNull(body.area_m2) : undefined,
      usable_area_m2: hasOwn(body, "usable_area_m2")
        ? toNumberOrNull(body.usable_area_m2)
        : undefined,
      built_area_total_m2: hasOwn(body, "built_area_total_m2")
        ? toNumberOrNull(body.built_area_total_m2)
        : undefined,
      terrace_m2: hasOwn(body, "terrace_m2") ? toNumberOrNull(body.terrace_m2) : undefined,
      exterior_area_m2: hasOwn(body, "exterior_area_m2")
        ? toNumberOrNull(body.exterior_area_m2)
        : undefined,
      garden_m2: hasOwn(body, "garden_m2") ? toNumberOrNull(body.garden_m2) : undefined,
      plot_m2: hasOwn(body, "plot_m2") ? toNumberOrNull(body.plot_m2) : undefined,
      bedrooms: hasOwn(body, "bedrooms") ? toNumberOrNull(body.bedrooms) : undefined,
      bathrooms: hasOwn(body, "bathrooms") ? toNumberOrNull(body.bathrooms) : undefined,
      garages: hasOwn(body, "garages") ? toNumberOrNull(body.garages) : undefined,
      storage_rooms: hasOwn(body, "storage_rooms") ? toNumberOrNull(body.storage_rooms) : undefined,
      floor_level: hasOwn(body, "floor_level") ? toNumberOrNull(body.floor_level) : undefined,
      year_built: hasOwn(body, "year_built") ? toNumberOrNull(body.year_built) : undefined,
      community_fees_monthly: hasOwn(body, "community_fees_monthly")
        ? toNumberOrNull(body.community_fees_monthly)
        : undefined,
      ibi_yearly: hasOwn(body, "ibi_yearly") ? toNumberOrNull(body.ibi_yearly) : undefined,
      floor_label: hasOwn(body, "floor_label") ? toOptionalText(body.floor_label) : undefined,
      building_block: hasOwn(body, "building_block")
        ? toOptionalText(body.building_block)
        : undefined,
      building_portal: hasOwn(body, "building_portal")
        ? toOptionalText(body.building_portal)
        : undefined,
      building_door: hasOwn(body, "building_door") ? toOptionalText(body.building_door) : undefined,
      building_name: hasOwn(body, "building_name") ? toOptionalText(body.building_name) : undefined,
      orientation: hasOwn(body, "orientation") ? toOptionalText(body.orientation) : undefined,
      condition: hasOwn(body, "condition") ? toOptionalText(body.condition) : undefined,
      cadastral_ref: hasOwn(body, "cadastral_ref") ? toOptionalText(body.cadastral_ref) : undefined,
      energy_rating: hasOwn(body, "energy_rating") ? toOptionalText(body.energy_rating) : undefined,
      elevator: hasOwn(body, "elevator") ? toBoolean(body.elevator, false) : undefined,
      rent_price_on_request: hasOwn(body, "rent_price_on_request")
        ? toBoolean(body.rent_price_on_request, false)
        : undefined,
    });
  }

  if (!Object.keys(updatePayload).length) {
    const { data: sameData, error: sameError } = await client
      .schema("crm")
      .from("properties")
      .select(SELECT_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (sameError) {
      return jsonResponse(
        {
          ok: false,
          error: "db_read_error",
          details: sameError.message,
        },
        { status: 500 }
      );
    }
    if (!sameData) return jsonResponse({ ok: false, error: "property_not_found" }, { status: 404 });
    return jsonResponse({
      ok: true,
      data: mapPropertyRow(sameData as Record<string, unknown>),
      meta: { storage: "supabase.crm.properties", unchanged: true },
    });
  }

  const previousStatus =
    typeof current.status === "string" ? normalizePropertyStatus(current.status) : ("draft" as PropertyStatus);

  const { data, error } = await client
    .schema("crm")
    .from("properties")
    .update(updatePayload)
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_update_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  const updatedStatus =
    typeof data.status === "string" ? normalizePropertyStatus(data.status) : ("draft" as PropertyStatus);
  if (previousStatus !== updatedStatus) {
    await insertStatusHistory({
      organization_id: organizationId,
      property_id: id,
      from_status: previousStatus,
      to_status: updatedStatus,
      note: toOptionalText(body.status_note),
    });
  }

  return jsonResponse({
    ok: true,
    data: mapPropertyRow(data as Record<string, unknown>),
    meta: {
      storage: "supabase.crm.properties",
      persisted: true,
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
