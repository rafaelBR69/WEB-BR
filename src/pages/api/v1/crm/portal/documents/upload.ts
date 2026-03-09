import type { APIRoute } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse, methodNotAllowed } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";
import { CRM_EDITOR_ROLES, resolveCrmOrgAccess } from "@/utils/crmAccess";
import { asBoolean, asNumber, asText, asUuid } from "@/utils/crmPortal";

type PortalDocumentVisibility = "crm_only" | "agent" | "client" | "both";
type PortalDocumentKind = "agency_kit" | "client_kit" | "shared_kit" | "other";

const DEFAULT_BUCKET = "crm-portal-documents";
const DEFAULT_MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
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

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const ALLOWED_EXTENSIONS = new Set(Object.keys(MIME_BY_EXTENSION));
const ALLOWED_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));

const asPortalDocumentVisibility = (value: unknown): PortalDocumentVisibility | null => {
  if (value === "crm_only" || value === "agent" || value === "client" || value === "both") {
    return value;
  }
  return null;
};

const asPortalDocumentKind = (value: unknown): PortalDocumentKind | null => {
  if (value === "agency_kit" || value === "client_kit" || value === "shared_kit" || value === "other") {
    return value;
  }
  return null;
};

const mapKindToVisibility = (kind: PortalDocumentKind): PortalDocumentVisibility => {
  if (kind === "agency_kit") return "agent";
  if (kind === "client_kit") return "client";
  if (kind === "shared_kit") return "both";
  return "both";
};

const mapVisibilityToKind = (visibility: PortalDocumentVisibility): PortalDocumentKind => {
  if (visibility === "agent") return "agency_kit";
  if (visibility === "client") return "client_kit";
  if (visibility === "both") return "shared_kit";
  return "other";
};

const asFileSizeBytes = (value: unknown): number | null => {
  const parsed = asNumber(value);
  if (parsed == null || !Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
};

const sanitizePathSegment = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const isAlreadyExistsError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return normalized.includes("already exists") || normalized.includes("duplicate");
};

const getBucket = (): string => {
  return (
    asText(import.meta.env.CRM_PORTAL_DOCUMENTS_BUCKET) ??
    asText(import.meta.env.PUBLIC_CRM_PORTAL_DOCUMENTS_BUCKET) ??
    DEFAULT_BUCKET
  );
};

const getMaxUploadBytes = (): number => {
  const parsed = Number(import.meta.env.CRM_PORTAL_DOCUMENTS_MAX_BYTES);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return DEFAULT_MAX_UPLOAD_BYTES;
};

const inferExtension = (file: File): string | null => {
  const fromName = asText(file.name)
    ?.split(".")
    .pop()
    ?.toLowerCase();
  if (fromName && ALLOWED_EXTENSIONS.has(fromName)) return fromName;

  const fromMime = Object.entries(MIME_BY_EXTENSION).find(([, mime]) => mime === file.type)?.[0] ?? null;
  if (fromMime && ALLOWED_EXTENSIONS.has(fromMime)) return fromMime;

  return null;
};

const inferMimeType = (file: File, extension: string): string | null => {
  const fromFile = asText(file.type)?.toLowerCase() ?? null;
  if (fromFile && ALLOWED_MIME_TYPES.has(fromFile)) return fromFile;
  return MIME_BY_EXTENSION[extension] ?? null;
};

const ensurePrivateBucket = async (client: SupabaseClient, bucket: string) => {
  const { error: createError } = await client.storage.createBucket(bucket, { public: false });
  if (createError && !isAlreadyExistsError(createError.message)) {
    throw new Error(`storage_bucket_error:${createError.message}`);
  }

  const { error: updateError } = await client.storage.updateBucket(bucket, { public: false });
  if (updateError) {
    throw new Error(`storage_bucket_update_error:${updateError.message}`);
  }
};

const createSignedDownloadUrl = async (
  client: SupabaseClient,
  bucket: string,
  path: string,
  title: string
): Promise<string | null> => {
  const { data, error } = await client.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { download: title });
  if (error) return null;
  return asText(data?.signedUrl);
};

const mapPortalDocumentRow = (
  row: Record<string, unknown>,
  options: { kind: PortalDocumentKind | null; downloadUrl: string | null }
) => ({
  id: asText(row.id),
  organization_id: asText(row.organization_id),
  property_id: asText(row.property_id),
  project_property_id: asText(row.project_property_id),
  title: asText(row.title),
  mime_type: asText(row.mime_type),
  file_size_bytes: asFileSizeBytes(row.file_size_bytes),
  is_private: row.is_private !== false,
  portal_visibility: asPortalDocumentVisibility(row.portal_visibility) ?? "crm_only",
  portal_is_published: row.portal_is_published === true,
  portal_published_at: asText(row.portal_published_at),
  created_at: asText(row.created_at),
  document_kind: options.kind,
  download_url: options.downloadUrl,
  download_url_ttl_seconds: options.downloadUrl ? SIGNED_URL_TTL_SECONDS : null,
});

type ResolvedDocumentPropertyScope =
  | {
      ok: true;
      data: {
        organization_id: string;
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
    .eq("id", sourcePropertyId)
    .eq("organization_id", organizationId)
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
  const scopedOrganizationId = asText(sourceRow.organization_id) ?? organizationId;
  const sourceRecordType = asText(sourceRow.record_type) ?? "project";

  if (sourceRecordType === "project") {
    return {
      ok: true,
      data: {
        organization_id: scopedOrganizationId,
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
    .eq("id", parentPropertyId)
    .eq("organization_id", organizationId)
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
      organization_id: scopedOrganizationId,
      source_property_id: sourceId,
      project_property_id: asText(parentRow.id) ?? parentPropertyId,
    },
  };
};

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!hasSupabaseServerClient()) {
    return jsonResponse(
      {
        ok: false,
        error: "upload_requires_supabase",
        details: "SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorios.",
      },
      { status: 501 }
    );
  }

  const formData = await request.formData();
  const organizationId = asText(formData.get("organization_id"));
  const sourcePropertyId = asUuid(formData.get("property_id")) ?? asUuid(formData.get("project_property_id"));
  const title = asText(formData.get("title"));
  const visibilityRaw = asText(formData.get("portal_visibility"));
  const kindRaw = asText(formData.get("document_kind"));
  const portalIsPublished = asBoolean(formData.get("portal_is_published")) ?? false;
  const isPrivate = asBoolean(formData.get("is_private")) ?? true;
  const fileValue = formData.get("file");

  const visibility = asPortalDocumentVisibility(visibilityRaw);
  const kind = asPortalDocumentKind(kindRaw);
  const resolvedVisibility = visibility ?? (kind ? mapKindToVisibility(kind) : "both");
  const resolvedKind = kind ?? mapVisibilityToKind(resolvedVisibility);

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (!sourcePropertyId) return jsonResponse({ ok: false, error: "property_id_required" }, { status: 422 });
  if (!(fileValue instanceof File)) return jsonResponse({ ok: false, error: "file_required" }, { status: 422 });
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
  if (visibilityRaw && !visibility) {
    return jsonResponse({ ok: false, error: "invalid_portal_visibility" }, { status: 422 });
  }
  if (kindRaw && !kind) {
    return jsonResponse({ ok: false, error: "invalid_document_kind" }, { status: 422 });
  }

  const maxUploadBytes = getMaxUploadBytes();
  if (!Number.isFinite(fileValue.size) || fileValue.size <= 0) {
    return jsonResponse({ ok: false, error: "empty_file" }, { status: 422 });
  }
  if (fileValue.size > maxUploadBytes) {
    return jsonResponse(
      {
        ok: false,
        error: "file_too_large",
        details: `Maximo ${Math.floor(maxUploadBytes / (1024 * 1024))} MB por archivo.`,
      },
      { status: 422 }
    );
  }

  const extension = inferExtension(fileValue);
  if (!extension) return jsonResponse({ ok: false, error: "unsupported_file_type" }, { status: 422 });

  const mimeType = inferMimeType(fileValue, extension);
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    return jsonResponse({ ok: false, error: "unsupported_file_type" }, { status: 422 });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const resolvedPropertyScope = await resolveDocumentPropertyScope(client, organizationId, sourcePropertyId);
  if (!resolvedPropertyScope.ok) {
    return jsonResponse(
      {
        ok: false,
        error: resolvedPropertyScope.error,
        details: resolvedPropertyScope.details,
      },
      { status: resolvedPropertyScope.status }
    );
  }

  const scopedOrganizationId = resolvedPropertyScope.data.organization_id;
  const scopedSourcePropertyId = resolvedPropertyScope.data.source_property_id;
  const scopedProjectPropertyId = resolvedPropertyScope.data.project_property_id;
  if (!scopedOrganizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });

  const bucket = getBucket();
  try {
    await ensurePrivateBucket(client, bucket);
  } catch (error) {
    const details = error instanceof Error ? error.message : "storage_bucket_error";
    return jsonResponse({ ok: false, error: "storage_bucket_error", details }, { status: 500 });
  }

  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const safeOrganization = sanitizePathSegment(scopedOrganizationId);
  const safeProject = sanitizePathSegment(scopedProjectPropertyId);
  const safeSourceProperty = sanitizePathSegment(scopedSourcePropertyId);
  const safeFileBase =
    sanitizePathSegment((asText(fileValue.name)?.replace(/\.[^.]+$/, "") ?? "").slice(0, 120)) || "document";
  const filePath = [
    "org",
    safeOrganization,
    "project",
    safeProject,
    "property",
    safeSourceProperty,
    "portal",
    resolvedKind,
    yyyy,
    mm,
    `${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${safeFileBase}.${extension}`,
  ].join("/");

  const { error: uploadError } = await client.storage.from(bucket).upload(filePath, fileValue, {
    upsert: false,
    contentType: mimeType,
    cacheControl: "3600",
  });

  if (uploadError) {
    return jsonResponse(
      {
        ok: false,
        error: "storage_upload_error",
        details: uploadError.message,
      },
      { status: 500 }
    );
  }

  const fallbackTitle = `${resolvedKind.replace("_", " ")} - ${asText(fileValue.name) ?? "documento"}`;
  const resolvedTitle = title ?? fallbackTitle;

  const insertPayload = {
    organization_id: scopedOrganizationId,
    scope: "property",
    property_id: scopedSourcePropertyId,
    project_property_id: scopedProjectPropertyId,
    title: resolvedTitle,
    storage_bucket: bucket,
    storage_path: filePath,
    mime_type: mimeType,
    file_size_bytes: fileValue.size,
    is_private: isPrivate,
    portal_visibility: resolvedVisibility,
    portal_is_published: portalIsPublished,
  };

  const { data: documentRow, error: insertError } = await client
    .schema("crm")
    .from("documents")
    .insert(insertPayload)
    .select(DOCUMENT_SELECT_COLUMNS)
    .single();

  if (insertError) {
    try {
      await client.storage.from(bucket).remove([filePath]);
    } catch {
      // no-op
    }
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_document_insert_error",
        details: insertError.message,
      },
      { status: 500 }
    );
  }

  const downloadUrl = await createSignedDownloadUrl(client, bucket, filePath, resolvedTitle);

  return jsonResponse(
    {
      ok: true,
      data: mapPortalDocumentRow(documentRow as Record<string, unknown>, {
        kind: resolvedKind,
        downloadUrl,
      }),
      meta: {
        persisted: true,
        storage: "supabase.crm.documents",
        signed_url_ttl_seconds: SIGNED_URL_TTL_SECONDS,
      },
    },
    { status: 201 }
  );
};

export const GET: APIRoute = async () => methodNotAllowed(["POST"]);
export const PUT: APIRoute = async () => methodNotAllowed(["POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["POST"]);
