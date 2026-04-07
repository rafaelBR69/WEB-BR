import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed } from "@shared/api/json";
import { getSupabaseServerClient } from "@shared/supabase/server";
import {
  PORTAL_MEMBERSHIP_SELECT_COLUMNS,
  asText,
  defaultMembershipScopeForRole,
  isPortalProjectPublished,
  mapPortalMembershipRow,
  mapPortalPropertyMedia,
} from "@shared/portal/domain";
import { resolvePortalRequestContext } from "@shared/portal/auth";

const PROJECT_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "legacy_code",
  "record_type",
  "project_business_type",
  "status",
  "property_data",
  "media",
  "translations",
  "commercialization_notes",
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

const attachAvailableUnitCounts = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  projects: Array<Record<string, unknown>>,
  organizationId: string | null
) => {
  const projectIds = Array.from(
    new Set(
      projects
        .map((project) => asText(project.id))
        .filter((value): value is string => Boolean(value))
    )
  );

  if (!projectIds.length) {
    return {
      data: projects.map((project) => ({
        ...project,
        available_units_count: 0,
      })),
      error: null as string | null,
      details: null as string | null,
    };
  }

  let unitsQuery = client
    .schema("crm")
    .from("properties")
    .select("parent_property_id")
    .eq("record_type", "unit")
    .eq("status", "available")
    .in("parent_property_id", projectIds);

  if (organizationId) unitsQuery = unitsQuery.eq("organization_id", organizationId);

  const { data: availableUnitsRaw, error: availableUnitsError } = await unitsQuery;
  if (availableUnitsError) {
    return {
      data: [] as Array<Record<string, unknown>>,
      error: "db_portal_units_count_read_error",
      details: availableUnitsError.message,
    };
  }

  const availableUnitsByProject = new Map<string, number>();
  ((availableUnitsRaw ?? []) as Array<Record<string, unknown>>).forEach((row) => {
    const parentProjectId = asText(row.parent_property_id);
    if (!parentProjectId) return;
    const current = availableUnitsByProject.get(parentProjectId) ?? 0;
    availableUnitsByProject.set(parentProjectId, current + 1);
  });

  return {
    data: projects.map((project) => {
      const projectId = asText(project.id);
      return {
        ...project,
        available_units_count: projectId ? availableUnitsByProject.get(projectId) ?? 0 : 0,
      };
    }),
    error: null as string | null,
    details: null as string | null,
  };
};

export const GET: APIRoute = async ({ url, request }) => {
  const organizationIdHint = asText(url.searchParams.get("organization_id"));
  const statusFilter = asText(url.searchParams.get("status"));
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
  if (!portalAccountId) return jsonResponse({ ok: false, error: "portal_account_id_missing" }, { status: 500 });

  if (isAdmin) {
    let adminProjectsQuery = client
      .schema("crm")
      .from("properties")
      .select(PROJECT_SELECT_COLUMNS)
      .eq("record_type", "project")
      .order("updated_at", { ascending: false });

    if (organizationId) adminProjectsQuery = adminProjectsQuery.eq("organization_id", organizationId);
    if (statusFilter) adminProjectsQuery = adminProjectsQuery.eq("status", statusFilter);

    const { data: adminProjectsRaw, error: adminProjectsError } = await adminProjectsQuery;
    if (adminProjectsError) {
      return jsonResponse(
        {
          ok: false,
          error: "db_portal_projects_read_error",
          details: adminProjectsError.message,
        },
        { status: 500 }
      );
    }

    const adminProjects = ((adminProjectsRaw ?? []) as Array<Record<string, unknown>>)
      .filter((project) => isPortalProjectPublished(project))
      .filter((entry) => {
        if (!q) return true;
        const translations = entry.translations as Record<string, unknown> | null;
        const es = translations && typeof translations.es === "object" ? (translations.es as Record<string, unknown>) : {};
        const en = translations && typeof translations.en === "object" ? (translations.en as Record<string, unknown>) : {};
        const titleEs = asText(es.title) ?? "";
        const titleEn = asText(en.title) ?? "";
        const legacyCode = asText(entry.legacy_code) ?? "";
        const composed = `${titleEs} ${titleEn} ${legacyCode}`.toLowerCase();
        return composed.includes(q);
      })
      .map((project) => {
        const projectId = asText(project.id);
        return {
          ...project,
          media: mapPortalPropertyMedia(project.media),
          membership:
            projectId && organizationId
              ? buildImplicitAdminMembership(portalAccountId, organizationId, projectId)
              : null,
        };
      });

    const withUnitCounts = await attachAvailableUnitCounts(client, adminProjects, organizationId);
    if (withUnitCounts.error) {
      return jsonResponse(
        {
          ok: false,
          error: withUnitCounts.error,
          details: withUnitCounts.details,
        },
        { status: 500 }
      );
    }

    return jsonResponse({
      ok: true,
      data: withUnitCounts.data,
      meta: {
        count: withUnitCounts.data.length,
        implicit_admin_access: true,
        storage: "supabase.crm.properties (portal_agent_admin)",
      },
    });
  }

  let membershipsQuery = client
    .schema("crm")
    .from("portal_memberships")
    .select(PORTAL_MEMBERSHIP_SELECT_COLUMNS)
    .eq("portal_account_id", portalAccountId);

  if (organizationId) membershipsQuery = membershipsQuery.eq("organization_id", organizationId);

  const { data: membershipsRaw, error: membershipsError } = await membershipsQuery;
  if (membershipsError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_memberships_read_error",
        details: membershipsError.message,
      },
      { status: 500 }
    );
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
    return jsonResponse({
      ok: true,
      data: [],
      meta: {
        count: 0,
        storage: "supabase.crm.portal_memberships",
      },
    });
  }

  let projectsQuery = client
    .schema("crm")
    .from("properties")
    .select(PROJECT_SELECT_COLUMNS)
    .in("id", projectIds)
    .eq("record_type", "project")
    .order("updated_at", { ascending: false });

  if (organizationId) projectsQuery = projectsQuery.eq("organization_id", organizationId);
  if (statusFilter) projectsQuery = projectsQuery.eq("status", statusFilter);

  const { data: projectsRaw, error: projectsError } = await projectsQuery;
  if (projectsError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_projects_read_error",
        details: projectsError.message,
      },
      { status: 500 }
    );
  }

  const projects = (projectsRaw ?? []) as Array<Record<string, unknown>>;
  const membershipsByProjectId = new Map<string, ReturnType<typeof mapPortalMembershipRow>>();
  memberships.forEach((entry) => {
    if (!entry.project_property_id) return;
    membershipsByProjectId.set(entry.project_property_id, entry);
  });

  const filtered = projects
    .filter((project) => isPortalProjectPublished(project))
    .map((project) => {
      const projectId = asText(project.id);
      return {
        ...project,
        media: mapPortalPropertyMedia(project.media),
        membership: projectId ? membershipsByProjectId.get(projectId) ?? null : null,
      };
    })
    .filter((entry) => {
      if (!q) return true;
      const translations = entry.translations as Record<string, unknown> | null;
      const es = translations && typeof translations.es === "object" ? (translations.es as Record<string, unknown>) : {};
      const en = translations && typeof translations.en === "object" ? (translations.en as Record<string, unknown>) : {};
      const titleEs = asText(es.title) ?? "";
      const titleEn = asText(en.title) ?? "";
      const legacyCode = asText(entry.legacy_code) ?? "";
      const composed = `${titleEs} ${titleEn} ${legacyCode}`.toLowerCase();
      return composed.includes(q);
    });

  const withUnitCounts = await attachAvailableUnitCounts(client, filtered, organizationId);
  if (withUnitCounts.error) {
    return jsonResponse(
      {
        ok: false,
        error: withUnitCounts.error,
        details: withUnitCounts.details,
      },
      { status: 500 }
    );
  }

  return jsonResponse({
    ok: true,
    data: withUnitCounts.data,
    meta: {
      count: withUnitCounts.data.length,
      storage: "supabase.crm.properties + crm.portal_memberships",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET"]);
