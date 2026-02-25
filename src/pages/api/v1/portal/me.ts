import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed } from "@/utils/crmApi";
import { getSupabaseServerClient } from "@/utils/supabaseServer";
import {
  PORTAL_MEMBERSHIP_SELECT_COLUMNS,
  asText,
  isPortalProjectPublished,
  mapPortalMembershipRow,
} from "@/utils/crmPortal";
import { resolvePortalRequestContext } from "@/utils/portalAuth";

const PROJECT_SELECT_COLUMNS =
  "id, organization_id, legacy_code, record_type, status, translations, parent_property_id, property_data, updated_at";

export const GET: APIRoute = async ({ url, request }) => {
  const organizationIdHint = asText(url.searchParams.get("organization_id"));
  const includeInactiveMemberships = url.searchParams.get("include_inactive_memberships") === "true";

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

  let membershipQuery = client
    .schema("crm")
    .from("portal_memberships")
    .select(PORTAL_MEMBERSHIP_SELECT_COLUMNS)
    .eq("portal_account_id", portalAccountId)
    .order("created_at", { ascending: true });

  if (organizationId) {
    membershipQuery = membershipQuery.eq("organization_id", organizationId);
  }
  if (!includeInactiveMemberships) {
    membershipQuery = membershipQuery.eq("status", "active");
  }

  const { data: membershipsRaw, error: membershipsError } = await membershipQuery;
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

  const memberships = (membershipsRaw ?? []).map((row) => mapPortalMembershipRow(row as Record<string, unknown>));
  const projectIds = Array.from(
    new Set(
      memberships
        .map((entry) => entry.project_property_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );

  let projects: Array<Record<string, unknown>> = [];
  if (projectIds.length) {
    let projectsQuery = client
      .schema("crm")
      .from("properties")
      .select(PROJECT_SELECT_COLUMNS)
      .in("id", projectIds)
      .eq("record_type", "project");

    if (organizationId) {
      projectsQuery = projectsQuery.eq("organization_id", organizationId);
    }

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
    projects = ((projectsRaw ?? []) as Array<Record<string, unknown>>).filter((row) =>
      isPortalProjectPublished(row)
    );
  }

  const projectsById = new Map<string, Record<string, unknown>>();
  projects.forEach((row) => {
    const id = asText(row.id);
    if (!id) return;
    projectsById.set(id, row);
  });

  const hydratedMemberships = memberships.map((entry) => ({
    ...entry,
    project:
      entry.project_property_id && projectsById.has(entry.project_property_id)
        ? projectsById.get(entry.project_property_id)
        : null,
  }));

  return jsonResponse({
    ok: true,
    data: {
      portal_account: auth.data.portal_account,
      auth_user_id: auth.data.auth_user_id,
      memberships: hydratedMemberships,
      projects,
    },
    meta: {
      storage: "supabase.crm.portal_accounts",
      memberships_count: memberships.length,
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET"]);
