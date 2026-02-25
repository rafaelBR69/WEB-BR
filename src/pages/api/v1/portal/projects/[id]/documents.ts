import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed } from "@/utils/crmApi";
import { getSupabaseServerClient } from "@/utils/supabaseServer";
import {
  asText,
  documentVisibilityAllowedForRole,
  getActivePortalMembershipForProject,
  normalizePortalDocumentVisibility,
} from "@/utils/crmPortal";
import { resolvePortalRequestContext } from "@/utils/portalAuth";

const getProjectId = (params: Record<string, string | undefined>): string | null => {
  const value = params.id;
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
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
    .from("documents")
    .select(
      "id, organization_id, project_property_id, title, storage_bucket, storage_path, mime_type, file_size_bytes, portal_visibility, portal_is_published, portal_published_at, created_at"
    )
    .eq("project_property_id", projectId)
    .eq("portal_is_published", true)
    .neq("portal_visibility", "crm_only")
    .order("portal_published_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (organizationId) query = query.eq("organization_id", organizationId);

  const { data, error } = await query;
  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_documents_read_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  const role = auth.data.portal_account.role;
  const filtered = ((data ?? []) as Array<Record<string, unknown>>)
    .filter((row) => documentVisibilityAllowedForRole(role, normalizePortalDocumentVisibility(row.portal_visibility)))
    .filter((row) => {
      if (!q) return true;
      const title = asText(row.title) ?? "";
      const path = asText(row.storage_path) ?? "";
      const mime = asText(row.mime_type) ?? "";
      return `${title} ${path} ${mime}`.toLowerCase().includes(q);
    });

  return jsonResponse({
    ok: true,
    data: filtered,
    meta: {
      count: filtered.length,
      role,
      membership_scope: membership.data.access_scope,
      storage: "supabase.crm.documents",
      note: "document download should use signed URLs from private bucket",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET"]);
