import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed } from "@shared/api/json";
import { getSupabaseServerClient } from "@shared/supabase/server";
import {
  PORTAL_MEMBERSHIP_SELECT_COLUMNS,
  asNumber,
  asObject,
  asText,
  defaultMembershipScopeForRole,
  isPortalProjectPublished,
  mapPortalMembershipRow,
} from "@shared/portal/domain";
import { resolvePortalRequestContext } from "@shared/portal/auth";

const PROJECT_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "legacy_code",
  "record_type",
  "status",
  "translations",
].join(", ");

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

const buildImplicitAdminMembership = (
  portalAccountId: string,
  organizationId: string,
  projectId: string
) =>
  mapPortalMembershipRow({
    id: `implicit_admin:${portalAccountId}:${projectId}`,
    organization_id: organizationId,
    portal_account_id: portalAccountId,
    project_property_id: projectId,
    access_scope: defaultMembershipScopeForRole("portal_agent_admin"),
    status: "active",
    dispute_window_hours: 48,
    permissions: {
      implicit_admin_access: true,
      source: "portal_agent_admin_role",
    },
    revoked_at: null,
    created_by: null,
    created_at: null,
    updated_at: null,
  });

const pickProjectTitle = (row: Record<string, unknown>): string => {
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
    "Proyecto"
  );
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

const mapUnitRow = (
  row: Record<string, unknown>,
  projectById: Map<string, Record<string, unknown>>
) => {
  const propertyData = asObject(row.property_data);
  const projectId = asText(row.parent_property_id);
  const projectRow = projectId ? projectById.get(projectId) ?? null : null;

  return {
    unit_id: asText(row.id),
    project_property_id: projectId,
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
    project_title: projectRow ? pickProjectTitle(projectRow) : null,
    project_status: projectRow ? asText(projectRow.status) ?? "active" : null,
  };
};

export const GET: APIRoute = async ({ request, url }) => {
  const organizationIdHint = asText(url.searchParams.get("organization_id"));
  const projectIdFilter = asText(url.searchParams.get("project_id"));
  const q = asText(url.searchParams.get("q"))?.toLowerCase() ?? "";

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
  const portalRole = auth.data.portal_account.role;
  const isAdmin = portalRole === "portal_agent_admin";

  if (!portalAccountId) {
    return jsonResponse({ ok: false, error: "portal_account_id_missing" }, { status: 500 });
  }

  let projects: Array<Record<string, unknown>> = [];

  if (isAdmin) {
    let query = client
      .schema("crm")
      .from("properties")
      .select(PROJECT_SELECT_COLUMNS)
      .eq("record_type", "project");

    if (organizationId) query = query.eq("organization_id", organizationId);
    if (projectIdFilter) query = query.eq("id", projectIdFilter);

    const { data, error } = await query;
    if (error) {
      return jsonResponse({ ok: false, error: "db_portal_projects_read_error", details: error.message }, { status: 500 });
    }

    projects = ((data ?? []) as Array<Record<string, unknown>>)
      .filter((project) => isPortalProjectPublished(project))
      .map((project) => ({
        ...project,
        membership:
          asText(project.id) && organizationId
            ? buildImplicitAdminMembership(portalAccountId, organizationId, asText(project.id) as string)
            : null,
      }));
  } else {
    let membershipsQuery = client
      .schema("crm")
      .from("portal_memberships")
      .select(PORTAL_MEMBERSHIP_SELECT_COLUMNS)
      .eq("portal_account_id", portalAccountId);

    if (organizationId) membershipsQuery = membershipsQuery.eq("organization_id", organizationId);

    const { data: membershipsRaw, error: membershipsError } = await membershipsQuery;
    if (membershipsError) {
      return jsonResponse({ ok: false, error: "db_portal_memberships_read_error", details: membershipsError.message }, { status: 500 });
    }

    const memberships = (membershipsRaw ?? [])
      .map((row) => mapPortalMembershipRow(row as Record<string, unknown>))
      .filter((entry) => entry.status === "active");

    const projectIds = Array.from(
      new Set(
        memberships
          .map((entry) => entry.project_property_id)
          .filter((value): value is string => typeof value === "string" && value.length > 0)
      )
    );

    if (!projectIds.length) {
      return jsonResponse({ ok: true, data: [], meta: { count: 0, projects_count: 0, storage: "supabase.crm.portal_memberships" } });
    }

    let projectsQuery = client
      .schema("crm")
      .from("properties")
      .select(PROJECT_SELECT_COLUMNS)
      .in("id", projectIds)
      .eq("record_type", "project");

    if (organizationId) projectsQuery = projectsQuery.eq("organization_id", organizationId);
    if (projectIdFilter) projectsQuery = projectsQuery.eq("id", projectIdFilter);

    const { data: projectsRaw, error: projectsError } = await projectsQuery;
    if (projectsError) {
      return jsonResponse({ ok: false, error: "db_portal_projects_read_error", details: projectsError.message }, { status: 500 });
    }

    const membershipByProject = new Map(memberships.map((entry) => [entry.project_property_id, entry] as const));

    projects = ((projectsRaw ?? []) as Array<Record<string, unknown>>)
      .filter((project) => isPortalProjectPublished(project))
      .map((project) => ({
        ...project,
        membership: membershipByProject.get(asText(project.id) ?? ""),
      }));
  }

  const projectIds = projects
    .map((project) => asText(project.id))
    .filter((value): value is string => Boolean(value));

  if (!projectIds.length) {
    return jsonResponse({ ok: true, data: [], meta: { count: 0, projects_count: 0, role: portalRole, storage: "supabase.crm.properties (projects authorized)" } });
  }

  let unitsQuery = client
    .schema("crm")
    .from("properties")
    .select(UNIT_SELECT_COLUMNS)
    .eq("record_type", "unit")
    .eq("status", "available")
    .in("parent_property_id", projectIds)
    .order("updated_at", { ascending: false });

  if (organizationId) unitsQuery = unitsQuery.eq("organization_id", organizationId);

  const { data: unitsRaw, error: unitsError } = await unitsQuery;
  if (unitsError) {
    return jsonResponse({ ok: false, error: "db_portal_properties_read_error", details: unitsError.message }, { status: 500 });
  }

  const projectById = new Map(
    projects
      .map((project) => {
        const projectId = asText(project.id);
        if (!projectId) return null;
        return [projectId, project] as const;
      })
      .filter((entry): entry is readonly [string, Record<string, unknown>] => Boolean(entry))
  );

  const units = ((unitsRaw ?? []) as Array<Record<string, unknown>>)
    .map((row) => mapUnitRow(row, projectById))
    .filter((row) => {
      if (!q) return true;
      const composed = [
        asText(row.title),
        asText(row.legacy_code),
        asText(row.project_title),
        asText(row.floor_label),
        asText(row.building_block),
      ]
        .filter((value) => Boolean(value))
        .join(" ")
        .toLowerCase();
      return composed.includes(q);
    });

  return jsonResponse({
    ok: true,
    data: units,
    meta: {
      count: units.length,
      projects_count: projectIds.length,
      role: portalRole,
      storage: "supabase.crm.properties (portal units aggregate)",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET"]);
