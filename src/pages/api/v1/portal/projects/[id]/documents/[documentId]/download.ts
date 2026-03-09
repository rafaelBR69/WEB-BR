import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed } from "@/utils/crmApi";
import { getSupabaseServerClient } from "@/utils/supabaseServer";
import {
  asObject,
  asText,
  documentVisibilityAllowedForRole,
  getActivePortalMembershipForProject,
  getRequestIp,
  getRequestUserAgent,
  normalizePortalDocumentVisibility,
  safeInsertPortalAccessLog,
} from "@/utils/crmPortal";
import { resolvePortalRequestContext } from "@/utils/portalAuth";

const SIGNED_URL_TTL_SECONDS = 120;

const getParam = (value: string | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

export const GET: APIRoute = async ({ params, request, url }) => {
  const projectId = getParam(params.id);
  const documentId = getParam(params.documentId);
  const organizationIdHint = asText(url.searchParams.get("organization_id"));

  if (!projectId) return jsonResponse({ ok: false, error: "project_id_required" }, { status: 400 });
  if (!documentId) return jsonResponse({ ok: false, error: "document_id_required" }, { status: 400 });

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
  if (!membership.data) return jsonResponse({ ok: false, error: "project_access_denied" }, { status: 403 });

  let query = client
    .schema("crm")
    .from("documents")
    .select(
      "id, organization_id, project_property_id, title, storage_bucket, storage_path, mime_type, portal_visibility, portal_is_published"
    )
    .eq("id", documentId)
    .eq("project_property_id", projectId)
    .eq("portal_is_published", true)
    .neq("portal_visibility", "crm_only")
    .maybeSingle();

  if (organizationId) query = query.eq("organization_id", organizationId);

  const { data, error } = await query;
  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_document_read_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  if (!data) return jsonResponse({ ok: false, error: "document_not_found" }, { status: 404 });

  const row = data as Record<string, unknown>;
  const role = auth.data.portal_account.role;
  const visibility = normalizePortalDocumentVisibility(row.portal_visibility);
  if (!documentVisibilityAllowedForRole(role, visibility)) {
    return jsonResponse({ ok: false, error: "document_access_denied" }, { status: 403 });
  }

  const bucket = asText(row.storage_bucket);
  const path = asText(row.storage_path);
  const title = asText(row.title) ?? "document";
  if (!bucket || !path) {
    return jsonResponse({ ok: false, error: "document_storage_path_missing" }, { status: 422 });
  }

  const { data: signed, error: signedError } = await client.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { download: title });

  const signedUrl = asText(signed?.signedUrl);
  if (signedError || !signedUrl) {
    return jsonResponse(
      {
        ok: false,
        error: "document_signed_url_error",
        details: signedError?.message ?? "signed_url_not_available",
      },
      { status: 500 }
    );
  }

  const organizationForLog = organizationId ?? asText(row.organization_id);
  if (organizationForLog) {
    const metadata = asObject(auth.data.portal_account.metadata);
    await safeInsertPortalAccessLog(client, {
      organization_id: organizationForLog,
      portal_account_id: portalAccountId,
      project_property_id: projectId,
      email: asText(metadata.email),
      event_type: "document_downloaded",
      ip: getRequestIp(request),
      user_agent: getRequestUserAgent(request),
      metadata: {
        document_id: asText(row.id),
        title,
        mime_type: asText(row.mime_type),
        visibility,
      },
    });
  }

  return jsonResponse({
    ok: true,
    data: {
      title,
      mime_type: asText(row.mime_type),
      download_url: signedUrl,
      download_url_ttl_seconds: SIGNED_URL_TTL_SECONDS,
    },
    meta: {
      storage: "supabase.crm.documents",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET"]);

