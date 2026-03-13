import type { APIRoute } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@shared/supabase/server";
import { CRM_EDITOR_ROLES, resolveCrmOrgAccess } from "@shared/crm/access";
import {
  asBoolean,
  asNumber,
  asText,
  asUuid,
  normalizePortalDocumentVisibility,
  toPositiveInt,
} from "@shared/portal/domain";

type PortalDocumentVisibility = "crm_only" | "agent" | "client" | "both";

type PatchPortalDocumentBody = {
  organization_id?: string;
  id?: string;
  title?: string | null;
  property_id?: string | null;
  project_property_id?: string | null;
  portal_visibility?: PortalDocumentVisibility;
  portal_is_published?: boolean | null;
  is_private?: boolean | null;
};

const SIGNED_URL_TTL_SECONDS = 180;

const DOCUMENT_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "property_id",
  "project_property_id",
  "title",
  "storage_bucket",
  "storage_path",
  "mime_type",
  "file_size_bytes",
  "is_private",
  "portal_visibility",
  "portal_is_published",
  "portal_published_at",
  "created_at",
].join(", ");

const asPortalDocumentVisibility = (value: unknown): PortalDocumentVisibility | null => {
  if (value === "crm_only" || value === "agent" || value === "client" || value === "both") {
    return value;
  }
  return null;
};

const asFileSizeBytes = (value: unknown): number | null => {
  const parsed = asNumber(value);
  if (parsed == null) return null;
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
};

const createSignedDownloadUrl = async (
  client: SupabaseClient,
  row: Record<string, unknown>
): Promise<string | null> => {
  const bucket = asText(row.storage_bucket);
  const path = asText(row.storage_path);
  const title = asText(row.title) ?? "document";
  if (!bucket || !path) return null;

  const { data, error } = await client.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { download: title });

  if (error) return null;
  return asText(data?.signedUrl);
};

const mapPortalDocumentRow = (row: Record<string, unknown>, downloadUrl: string | null) => ({
  id: asText(row.id),
  organization_id: asText(row.organization_id),
  property_id: asText(row.property_id),
  project_property_id: asText(row.project_property_id),
  title: asText(row.title),
  mime_type: asText(row.mime_type),
  file_size_bytes: asFileSizeBytes(row.file_size_bytes),
  is_private: row.is_private !== false,
  portal_visibility: normalizePortalDocumentVisibility(row.portal_visibility),
  portal_is_published: row.portal_is_published === true,
  portal_published_at: asText(row.portal_published_at),
  created_at: asText(row.created_at),
  download_url: downloadUrl,
  download_url_ttl_seconds: downloadUrl ? SIGNED_URL_TTL_SECONDS : null,
});

type ResolvedDocumentPropertyScope =
  | {
      ok: true;
      data: {
        source_property_id: string;
        project_property_id: string;
      };
    }
  | {
      ok: false;
      status: number;
      error: string;
      details?: string;
    };

const resolveDocumentPropertyScope = async (
  client: SupabaseClient,
  organizationId: string,
  sourcePropertyId: string
): Promise<ResolvedDocumentPropertyScope> => {
  const { data: sourcePropertyRow, error: sourcePropertyError } = await client
    .schema("crm")
    .from("properties")
    .select("id, organization_id, record_type, parent_property_id")
    .eq("organization_id", organizationId)
    .eq("id", sourcePropertyId)
    .maybeSingle();

  if (sourcePropertyError) {
    return {
      ok: false,
      status: 500,
      error: "db_property_read_error",
      details: sourcePropertyError.message,
    };
  }
  if (!sourcePropertyRow) {
    return {
      ok: false,
      status: 404,
      error: "property_not_found",
    };
  }

  const sourceRow = sourcePropertyRow as Record<string, unknown>;
  const sourceId = asText(sourceRow.id) ?? sourcePropertyId;
  const sourceRecordType = asText(sourceRow.record_type) ?? "project";

  if (sourceRecordType === "project") {
    return {
      ok: true,
      data: {
        source_property_id: sourceId,
        project_property_id: sourceId,
      },
    };
  }

  if (sourceRecordType !== "unit") {
    return {
      ok: false,
      status: 422,
      error: "invalid_property_record_type",
      details: "Solo se permiten propiedades de tipo project o unit para documentos del portal.",
    };
  }

  const parentPropertyId = asUuid(sourceRow.parent_property_id);
  if (!parentPropertyId) {
    return {
      ok: false,
      status: 422,
      error: "unit_parent_property_required",
    };
  }

  const { data: parentProjectRow, error: parentProjectError } = await client
    .schema("crm")
    .from("properties")
    .select("id, organization_id, record_type")
    .eq("organization_id", organizationId)
    .eq("id", parentPropertyId)
    .maybeSingle();

  if (parentProjectError) {
    return {
      ok: false,
      status: 500,
      error: "db_parent_property_read_error",
      details: parentProjectError.message,
    };
  }
  if (!parentProjectRow) {
    return {
      ok: false,
      status: 404,
      error: "parent_project_not_found",
    };
  }

  const parentRow = parentProjectRow as Record<string, unknown>;
  if (asText(parentRow.record_type) !== "project") {
    return {
      ok: false,
      status: 422,
      error: "unit_parent_must_be_project",
    };
  }

  return {
    ok: true,
    data: {
      source_property_id: sourceId,
      project_property_id: asText(parentRow.id) ?? parentPropertyId,
    },
  };
};

export const GET: APIRoute = async ({ url, cookies }) => {
  const organizationId = asText(url.searchParams.get("organization_id"));
  const id = asUuid(url.searchParams.get("id"));
  const propertyId = asUuid(url.searchParams.get("property_id"));
  const projectId = asUuid(url.searchParams.get("project_property_id"));
  const visibilityRaw = asText(url.searchParams.get("portal_visibility"));
  const visibility = asPortalDocumentVisibility(visibilityRaw);
  const isPublished = asBoolean(url.searchParams.get("portal_is_published"));
  const q = asText(url.searchParams.get("q"))?.toLowerCase() ?? "";
  const page = toPositiveInt(url.searchParams.get("page"), 1, 1, 10000);
  const perPage = toPositiveInt(url.searchParams.get("per_page"), 30, 1, 200);

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (visibilityRaw && !visibility) {
    return jsonResponse({ ok: false, error: "invalid_portal_visibility" }, { status: 422 });
  }
  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint: organizationId,
    allowedPermissions: ["crm.portal.read"],
  });
  if (access.error || !access.data) {
    return jsonResponse(
      {
        ok: false,
        error: access.error?.error ?? "crm_auth_required",
        details: access.error?.details,
      },
      { status: access.error?.status ?? 401 }
    );
  }

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: [],
      meta: {
        count: 0,
        total: 0,
        page,
        per_page: perPage,
        total_pages: 1,
        persisted: false,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let resolvedPropertyFilter: ResolvedDocumentPropertyScope | null = null;
  if (propertyId) {
    resolvedPropertyFilter = await resolveDocumentPropertyScope(client, organizationId, propertyId);
    if (!resolvedPropertyFilter.ok) {
      return jsonResponse(
        {
          ok: false,
          error: resolvedPropertyFilter.error,
          details: resolvedPropertyFilter.details,
        },
        { status: resolvedPropertyFilter.status }
      );
    }
  }

  let query = client
    .schema("crm")
    .from("documents")
    .select(DOCUMENT_SELECT_COLUMNS, { count: "exact" })
    .eq("organization_id", organizationId)
    .not("project_property_id", "is", null)
    .order("portal_published_at", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (id) query = query.eq("id", id);
  if (resolvedPropertyFilter?.ok) {
    const sourcePropertyId = resolvedPropertyFilter.data.source_property_id;
    const parentProjectId = resolvedPropertyFilter.data.project_property_id;
    if (sourcePropertyId === parentProjectId) query = query.eq("project_property_id", parentProjectId);
    else query = query.eq("property_id", sourcePropertyId);
  } else if (projectId) {
    query = query.eq("project_property_id", projectId);
  }
  if (visibility) query = query.eq("portal_visibility", visibility);
  if (isPublished != null) query = query.eq("portal_is_published", isPublished);
  if (q) query = query.or(`title.ilike.%${q}%,mime_type.ilike.%${q}%`);

  const { data, error, count } = await query;
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

  const rows = (data ?? []) as Array<Record<string, unknown>>;

  const mapped = await Promise.all(
    rows.map(async (row) => {
      const downloadUrl = await createSignedDownloadUrl(client, row);
      return mapPortalDocumentRow(row, downloadUrl);
    })
  );

  const total = typeof count === "number" ? count : mapped.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return jsonResponse({
    ok: true,
    data: mapped,
    meta: {
      count: mapped.length,
      total,
      page,
      per_page: perPage,
      total_pages: totalPages,
      signed_url_ttl_seconds: SIGNED_URL_TTL_SECONDS,
      storage: "supabase.crm.documents",
    },
  });
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const body = await parseJsonBody<PatchPortalDocumentBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationId = asText(body.organization_id);
  const documentId = asUuid(body.id);
  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (!documentId) return jsonResponse({ ok: false, error: "id_required" }, { status: 422 });
  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint: organizationId,
    allowedRoles: CRM_EDITOR_ROLES,
    allowedPermissions: ["crm.documents.manage"],
  });
  if (access.error || !access.data) {
    return jsonResponse(
      {
        ok: false,
        error: access.error?.error ?? "crm_auth_required",
        details: access.error?.details,
      },
      { status: access.error?.status ?? 401 }
    );
  }

  const updatePayload: Record<string, unknown> = {};
  const requestedPropertyIdRaw =
    body.property_id !== undefined ? body.property_id : body.project_property_id !== undefined ? body.project_property_id : undefined;
  const requestedPropertyId = requestedPropertyIdRaw !== undefined ? asUuid(requestedPropertyIdRaw) : null;

  if (requestedPropertyIdRaw !== undefined && !requestedPropertyId) {
    return jsonResponse({ ok: false, error: "property_id_required" }, { status: 422 });
  }

  if (body.title !== undefined) {
    const title = asText(body.title);
    if (!title) return jsonResponse({ ok: false, error: "title_required" }, { status: 422 });
    updatePayload.title = title;
  }

  if (body.portal_visibility !== undefined) {
    const visibility = asPortalDocumentVisibility(body.portal_visibility);
    if (!visibility) return jsonResponse({ ok: false, error: "invalid_portal_visibility" }, { status: 422 });
    updatePayload.portal_visibility = visibility;
  }

  if (body.portal_is_published !== undefined) {
    const published = asBoolean(body.portal_is_published);
    if (published == null) return jsonResponse({ ok: false, error: "invalid_portal_is_published" }, { status: 422 });
    updatePayload.portal_is_published = published;
  }

  if (body.is_private !== undefined) {
    const isPrivate = asBoolean(body.is_private);
    if (isPrivate == null) return jsonResponse({ ok: false, error: "invalid_is_private" }, { status: 422 });
    updatePayload.is_private = isPrivate;
  }

  if (!hasSupabaseServerClient()) {
    if (requestedPropertyId) {
      updatePayload.property_id = requestedPropertyId;
      updatePayload.project_property_id = requestedPropertyId;
    }
    if (!Object.keys(updatePayload).length) {
      return jsonResponse({ ok: false, error: "no_fields_to_update" }, { status: 422 });
    }
    return jsonResponse({
      ok: true,
      data: {
        id: documentId,
        organization_id: organizationId,
        ...updatePayload,
      },
      meta: {
        persisted: false,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  if (requestedPropertyId) {
    const resolution = await resolveDocumentPropertyScope(client, organizationId, requestedPropertyId);
    if (!resolution.ok) {
      return jsonResponse(
        {
          ok: false,
          error: resolution.error,
          details: resolution.details,
        },
        { status: resolution.status }
      );
    }
    updatePayload.property_id = resolution.data.source_property_id;
    updatePayload.project_property_id = resolution.data.project_property_id;
  }

  if (!Object.keys(updatePayload).length) {
    return jsonResponse({ ok: false, error: "no_fields_to_update" }, { status: 422 });
  }

  const { data, error } = await client
    .schema("crm")
    .from("documents")
    .update(updatePayload)
    .eq("organization_id", organizationId)
    .eq("id", documentId)
    .select(DOCUMENT_SELECT_COLUMNS)
    .maybeSingle();

  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_document_update_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  if (!data) return jsonResponse({ ok: false, error: "document_not_found" }, { status: 404 });

  const row = data as Record<string, unknown>;
  const downloadUrl = await createSignedDownloadUrl(client, row);

  return jsonResponse({
    ok: true,
    data: mapPortalDocumentRow(row, downloadUrl),
    meta: {
      storage: "supabase.crm.documents",
      signed_url_ttl_seconds: SIGNED_URL_TTL_SECONDS,
    },
  });
};

export const DELETE: APIRoute = async ({ request, url, cookies }) => {
  const body = await parseJsonBody<{ organization_id?: string; id?: string }>(request);
  const organizationId = asText(body?.organization_id) ?? asText(url.searchParams.get("organization_id"));
  const documentId = asUuid(body?.id) ?? asUuid(url.searchParams.get("id"));

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (!documentId) return jsonResponse({ ok: false, error: "id_required" }, { status: 422 });
  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint: organizationId,
    allowedRoles: CRM_EDITOR_ROLES,
    allowedPermissions: ["crm.documents.manage"],
  });
  if (access.error || !access.data) {
    return jsonResponse(
      {
        ok: false,
        error: access.error?.error ?? "crm_auth_required",
        details: access.error?.details,
      },
      { status: access.error?.status ?? 401 }
    );
  }

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: {
        id: documentId,
        deleted: true,
      },
      meta: {
        persisted: false,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const { data: existing, error: existingError } = await client
    .schema("crm")
    .from("documents")
    .select("id, storage_bucket, storage_path")
    .eq("organization_id", organizationId)
    .eq("id", documentId)
    .maybeSingle();

  if (existingError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_document_read_error",
        details: existingError.message,
      },
      { status: 500 }
    );
  }

  if (!existing) return jsonResponse({ ok: false, error: "document_not_found" }, { status: 404 });

  const { error: deleteError } = await client
    .schema("crm")
    .from("documents")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", documentId);

  if (deleteError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_document_delete_error",
        details: deleteError.message,
      },
      { status: 500 }
    );
  }

  const bucket = asText((existing as Record<string, unknown>).storage_bucket);
  const path = asText((existing as Record<string, unknown>).storage_path);
  if (bucket && path) {
    try {
      await client.storage.from(bucket).remove([path]);
    } catch {
      // no-op: storage cleanup should not break document deletion
    }
  }

  return jsonResponse({
    ok: true,
    data: {
      id: documentId,
      deleted: true,
    },
    meta: {
      storage: "supabase.crm.documents",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET", "PATCH", "DELETE"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET", "PATCH", "DELETE"]);
