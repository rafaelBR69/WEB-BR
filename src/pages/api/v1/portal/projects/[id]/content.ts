import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed } from "@/utils/crmApi";
import { getSupabaseServerClient } from "@/utils/supabaseServer";
import {
  asText,
  audienceAllowedForRole,
  getActivePortalMembershipForProject,
  normalizePortalAudience,
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
  const language = asText(url.searchParams.get("language"));

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
    .from("portal_content_blocks")
    .select("*")
    .eq("project_property_id", projectId)
    .eq("is_published", true)
    .order("section_key", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (organizationId) query = query.eq("organization_id", organizationId);
  if (language) query = query.eq("language", language);

  const { data, error } = await query;
  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_content_read_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  const role = auth.data.portal_account.role;
  const content = ((data ?? []) as Array<Record<string, unknown>>).filter((row) =>
    audienceAllowedForRole(role, normalizePortalAudience(row.audience))
  );

  return jsonResponse({
    ok: true,
    data: content,
    meta: {
      count: content.length,
      role,
      membership_scope: membership.data.access_scope,
      storage: "supabase.crm.portal_content_blocks",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET"]);
