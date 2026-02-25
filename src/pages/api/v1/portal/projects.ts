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

const PROJECT_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "legacy_code",
  "record_type",
  "project_business_type",
  "status",
  "property_data",
  "translations",
  "commercialization_notes",
  "updated_at",
].join(", ");

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
  if (!portalAccountId) return jsonResponse({ ok: false, error: "portal_account_id_missing" }, { status: 500 });

  let membershipsQuery = client
    .schema("crm")
    .from("portal_memberships")
    .select(PORTAL_MEMBERSHIP_SELECT_COLUMNS)
    .eq("portal_account_id", portalAccountId)
    .eq("status", "active");

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

  const memberships = (membershipsRaw ?? []).map((row) => mapPortalMembershipRow(row as Record<string, unknown>));
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

  return jsonResponse({
    ok: true,
    data: filtered,
    meta: {
      count: filtered.length,
      storage: "supabase.crm.properties + crm.portal_memberships",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET"]);
