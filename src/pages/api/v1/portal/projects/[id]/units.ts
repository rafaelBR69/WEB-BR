import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed } from "@/utils/crmApi";
import { getSupabaseServerClient } from "@/utils/supabaseServer";
import {
  asNumber,
  asObject,
  asText,
  getActivePortalMembershipForProject,
} from "@/utils/crmPortal";
import { resolvePortalRequestContext } from "@/utils/portalAuth";

const UNIT_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "legacy_code",
  "record_type",
  "status",
  "parent_property_id",
  "translations",
  "property_data",
  "price_sale",
  "price_rent_monthly",
  "price_currency",
  "updated_at",
].join(", ");

const getProjectId = (params: Record<string, string | undefined>): string | null => {
  const value = params.id;
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const pickUnitTitle = (row: Record<string, unknown>): string => {
  const translations = asObject(row.translations);
  const es = asObject(translations.es);
  const en = asObject(translations.en);

  return (
    asText(es.title) ??
    asText(es.name) ??
    asText(en.title) ??
    asText(en.name) ??
    asText(row.legacy_code) ??
    asText(row.id) ??
    "Unidad"
  );
};

const mapUnitRow = (row: Record<string, unknown>) => {
  const propertyData = asObject(row.property_data);
  return {
    unit_id: asText(row.id),
    project_property_id: asText(row.parent_property_id),
    organization_id: asText(row.organization_id),
    legacy_code: asText(row.legacy_code),
    title: pickUnitTitle(row),
    status: asText(row.status) ?? "available",
    price_sale: asNumber(row.price_sale),
    price_rent_monthly: asNumber(row.price_rent_monthly),
    currency: asText(row.price_currency) ?? "EUR",
    area_m2: asNumber(propertyData.area_m2),
    bedrooms: asNumber(propertyData.bedrooms),
    bathrooms: asNumber(propertyData.bathrooms),
    floor_label: asText(propertyData.floor_label),
    building_block: asText(propertyData.building_block),
    building_portal: asText(propertyData.building_portal),
    building_door: asText(propertyData.building_door),
    updated_at: asText(row.updated_at),
  };
};

export const GET: APIRoute = async ({ params, url, request }) => {
  const projectId = getProjectId(params);
  const organizationIdHint = asText(url.searchParams.get("organization_id"));
  const q = asText(url.searchParams.get("q"))?.toLowerCase() ?? "";

  if (!projectId) return jsonResponse({ ok: false, error: "project_id_required" }, { status: 400 });

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const auth = await resolvePortalRequestContext(request, { organizationIdHint });
  if (auth.error || !auth.data) {
    return jsonResponse(
      {
        ok: false,
        error: auth.error?.error ?? "auth_context_unresolved",
        details: auth.error?.details,
      },
      { status: auth.error?.status ?? 401 }
    );
  }

  const portalAccountId = auth.data.portal_account.id;
  const organizationId = auth.data.organization_id;
  if (!portalAccountId) return jsonResponse({ ok: false, error: "portal_account_id_missing" }, { status: 500 });

  const membership = await getActivePortalMembershipForProject(client, portalAccountId, projectId, organizationId);
  if (membership.error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_membership_read_error",
        details: membership.error.message,
      },
      { status: 500 }
    );
  }
  if (!membership.data) {
    return jsonResponse({ ok: false, error: "project_access_denied" }, { status: 403 });
  }

  let query = client
    .schema("crm")
    .from("properties")
    .select(UNIT_SELECT_COLUMNS)
    .eq("record_type", "unit")
    .eq("parent_property_id", projectId)
    .eq("status", "available")
    .order("updated_at", { ascending: false });

  if (organizationId) query = query.eq("organization_id", organizationId);

  const { data, error } = await query;
  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_project_units_read_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  const units = ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => mapUnitRow(row))
    .filter((row) => {
      if (!q) return true;
      const composed = `${asText(row.title) ?? ""} ${asText(row.legacy_code) ?? ""} ${asText(row.floor_label) ?? ""}`.toLowerCase();
      return composed.includes(q);
    });

  return jsonResponse({
    ok: true,
    data: units,
    meta: {
      count: units.length,
      role: auth.data.portal_account.role,
      membership_scope: membership.data.access_scope,
      project_id: projectId,
      storage: "supabase.crm.properties (units available)",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET"]);
