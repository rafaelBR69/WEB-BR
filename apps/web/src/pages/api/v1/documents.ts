import type { APIRoute } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@shared/supabase/server";
import {
  asBoolean,
  asNumber,
  asText,
  asUuid,
  normalizePortalDocumentVisibility,
  toPositiveInt,
} from "@shared/portal/domain";

type DocumentScope = "lead" | "client" | "property" | "contract" | "invoice" | "general";
type PortalDocumentVisibility = "crm_only" | "agent" | "client" | "both";

type CreateDocumentBody = {
  organization_id?: string;
  scope?: DocumentScope;
  title?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
  file_size_bytes?: number | null;
  is_private?: boolean | null;
  lead_id?: string | null;
  client_id?: string | null;
  property_id?: string | null;
  contract_id?: string | null;
  invoice_id?: string | null;
  project_property_id?: string | null;
  portal_visibility?: PortalDocumentVisibility;
  portal_is_published?: boolean | null;
};

type PatchDocumentBody = {
  organization_id?: string;
  id?: string;
  scope?: DocumentScope;
  title?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
  file_size_bytes?: number | null;
  is_private?: boolean | null;
  lead_id?: string | null;
  client_id?: string | null;
  property_id?: string | null;
  contract_id?: string | null;
  invoice_id?: string | null;
  project_property_id?: string | null;
  portal_visibility?: PortalDocumentVisibility;
  portal_is_published?: boolean | null;
};

const DOCUMENT_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "scope",
  "lead_id",
  "client_id",
  "property_id",
  "contract_id",
  "invoice_id",
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

const DEFAULT_STORAGE_BUCKET = "crm-documents";
const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;
const ALLOWED_SCOPES = new Set<DocumentScope>([
  "lead",
  "client",
  "property",
  "contract",
  "invoice",
  "general",
]);

const asDocumentScope = (value: unknown): DocumentScope | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase() as DocumentScope;
  return ALLOWED_SCOPES.has(normalized) ? normalized : null;
};

const asPortalDocumentVisibility = (value: unknown): PortalDocumentVisibility | null => {
  if (value === "crm_only" || value === "agent" || value === "client" || value === "both") {
    return value;
  }
  return null;
};

const asFileSizeBytes = (value: unknown): number | null => {
  const parsed = asNumber(value);
  if (parsed == null || !Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
};

const hasOwn = <T extends object>(value: T, key: keyof T): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const resolveNullableUuid = (
  value: unknown
): { ok: true; value: string | null } | { ok: false; error: string } => {
  if (value == null || value === "") return { ok: true, value: null };
  const parsed = asUuid(value);
  if (!parsed) return { ok: false, error: "invalid_uuid_value" };
  return { ok: true, value: parsed };
};

const createSignedDownloadUrl = async (
  client: SupabaseClient,
  row: Record<string, unknown>,
  ttlSeconds: number
): Promise<string | null> => {
  const bucket = asText(row.storage_bucket);
  const path = asText(row.storage_path);
  const title = asText(row.title) ?? "document";
  if (!bucket || !path) return null;

  const { data, error } = await client.storage.from(bucket).createSignedUrl(path, ttlSeconds, { download: title });
  if (error) return null;
  return asText(data?.signedUrl);
};

const mapDocumentRow = async (
  client: SupabaseClient,
  row: Record<string, unknown>,
  options: {
    includeStorage: boolean;
    includeSigned: boolean;
    signedTtlSeconds: number;
  }
) => {
  const out: Record<string, unknown> = {
    id: asText(row.id),
    organization_id: asText(row.organization_id),
    scope: asDocumentScope(row.scope) ?? "general",
    lead_id: asText(row.lead_id),
    client_id: asText(row.client_id),
    property_id: asText(row.property_id),
    contract_id: asText(row.contract_id),
    invoice_id: asText(row.invoice_id),
    project_property_id: asText(row.project_property_id),
    title: asText(row.title),
    mime_type: asText(row.mime_type),
    file_size_bytes: asFileSizeBytes(row.file_size_bytes),
    is_private: row.is_private !== false,
    portal_visibility: normalizePortalDocumentVisibility(row.portal_visibility),
    portal_is_published: row.portal_is_published === true,
    portal_published_at: asText(row.portal_published_at),
    created_at: asText(row.created_at),
  };

  if (options.includeStorage) {
    out.storage_bucket = asText(row.storage_bucket);
    out.storage_path = asText(row.storage_path);
  }

  if (options.includeSigned) {
    const downloadUrl = await createSignedDownloadUrl(client, row, options.signedTtlSeconds);
    out.download_url = downloadUrl;
    out.download_url_ttl_seconds = downloadUrl ? options.signedTtlSeconds : null;
  }

  return out;
};

export const GET: APIRoute = async ({ url }) => {
  const organizationId = asText(url.searchParams.get("organization_id"));
  const id = asUuid(url.searchParams.get("id"));
  const scopeRaw = asText(url.searchParams.get("scope"));
  const scope = asDocumentScope(scopeRaw);
  const leadId = asUuid(url.searchParams.get("lead_id"));
  const clientId = asUuid(url.searchParams.get("client_id"));
  const propertyId = asUuid(url.searchParams.get("property_id"));
  const contractId = asUuid(url.searchParams.get("contract_id"));
  const invoiceId = asUuid(url.searchParams.get("invoice_id"));
  const projectPropertyId = asUuid(url.searchParams.get("project_property_id"));
  const portalVisibilityRaw = asText(url.searchParams.get("portal_visibility"));
  const portalVisibility = asPortalDocumentVisibility(portalVisibilityRaw);
  const portalIsPublished = asBoolean(url.searchParams.get("portal_is_published"));
  const includeStorage = asBoolean(url.searchParams.get("include_storage")) ?? false;
  const includeSigned = asBoolean(url.searchParams.get("include_signed")) ?? true;
  const signedTtlSeconds = toPositiveInt(
    url.searchParams.get("signed_url_ttl_seconds"),
    DEFAULT_SIGNED_URL_TTL_SECONDS,
    60,
    3600
  );
  const q = asText(url.searchParams.get("q"))?.toLowerCase() ?? "";
  const page = toPositiveInt(url.searchParams.get("page"), 1, 1, 10000);
  const perPage = toPositiveInt(url.searchParams.get("per_page"), 25, 1, 200);

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (scopeRaw && !scope) return jsonResponse({ ok: false, error: "invalid_scope" }, { status: 422 });
  if (portalVisibilityRaw && !portalVisibility) {
    return jsonResponse({ ok: false, error: "invalid_portal_visibility" }, { status: 422 });
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

  let query = client
    .schema("crm")
    .from("documents")
    .select(DOCUMENT_SELECT_COLUMNS, { count: "exact" })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (id) query = query.eq("id", id);
  if (scope) query = query.eq("scope", scope);
  if (leadId) query = query.eq("lead_id", leadId);
  if (clientId) query = query.eq("client_id", clientId);
  if (propertyId) query = query.eq("property_id", propertyId);
  if (contractId) query = query.eq("contract_id", contractId);
  if (invoiceId) query = query.eq("invoice_id", invoiceId);
  if (projectPropertyId) query = query.eq("project_property_id", projectPropertyId);
  if (portalVisibility) query = query.eq("portal_visibility", portalVisibility);
  if (portalIsPublished != null) query = query.eq("portal_is_published", portalIsPublished);

  if (q) {
    query = query.or(
      includeStorage
        ? `title.ilike.%${q}%,mime_type.ilike.%${q}%,storage_path.ilike.%${q}%`
        : `title.ilike.%${q}%,mime_type.ilike.%${q}%`
    );
  }

  const { data, error, count } = await query;
  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_documents_read_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const mapped = await Promise.all(
    rows.map((row) =>
      mapDocumentRow(client, row, {
        includeStorage,
        includeSigned,
        signedTtlSeconds,
      })
    )
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
      include_storage: includeStorage,
      include_signed: includeSigned,
      signed_url_ttl_seconds: includeSigned ? signedTtlSeconds : null,
      storage: "supabase.crm.documents",
    },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<CreateDocumentBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationId = asText(body.organization_id);
  const scope = asDocumentScope(body.scope) ?? "general";
  const title = asText(body.title);
  const storageBucket = asText(body.storage_bucket) ?? DEFAULT_STORAGE_BUCKET;
  const storagePath = asText(body.storage_path);
  const mimeType = asText(body.mime_type);
  const fileSizeBytes = asFileSizeBytes(body.file_size_bytes);
  const isPrivate = asBoolean(body.is_private) ?? true;
  const portalVisibility = body.portal_visibility
    ? asPortalDocumentVisibility(body.portal_visibility)
    : normalizePortalDocumentVisibility(null);
  const portalIsPublished = asBoolean(body.portal_is_published) ?? false;

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (!title) return jsonResponse({ ok: false, error: "title_required" }, { status: 422 });
  if (!storagePath) return jsonResponse({ ok: false, error: "storage_path_required" }, { status: 422 });
  if (body.portal_visibility && !portalVisibility) {
    return jsonResponse({ ok: false, error: "invalid_portal_visibility" }, { status: 422 });
  }

  const leadIdResolved = resolveNullableUuid(body.lead_id);
  const clientIdResolved = resolveNullableUuid(body.client_id);
  const propertyIdResolved = resolveNullableUuid(body.property_id);
  const contractIdResolved = resolveNullableUuid(body.contract_id);
  const invoiceIdResolved = resolveNullableUuid(body.invoice_id);
  const projectIdResolved = resolveNullableUuid(body.project_property_id);
  if (
    !leadIdResolved.ok ||
    !clientIdResolved.ok ||
    !propertyIdResolved.ok ||
    !contractIdResolved.ok ||
    !invoiceIdResolved.ok ||
    !projectIdResolved.ok
  ) {
    return jsonResponse({ ok: false, error: "invalid_related_id" }, { status: 422 });
  }

  if (!hasSupabaseServerClient()) {
    return jsonResponse(
      {
        ok: true,
        data: {
          id: crypto.randomUUID(),
          organization_id: organizationId,
          scope,
          title,
          storage_bucket: storageBucket,
          storage_path: storagePath,
          mime_type: mimeType,
          file_size_bytes: fileSizeBytes,
          is_private: isPrivate,
          lead_id: leadIdResolved.value,
          client_id: clientIdResolved.value,
          property_id: projectIdResolved.value ?? propertyIdResolved.value,
          contract_id: contractIdResolved.value,
          invoice_id: invoiceIdResolved.value,
          project_property_id: projectIdResolved.value,
          portal_visibility,
          portal_is_published: portalIsPublished,
          created_at: new Date().toISOString(),
        },
        meta: {
          persisted: false,
          storage: "mock_in_memory",
        },
      },
      { status: 201 }
    );
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const payload = {
    organization_id: organizationId,
    scope,
    title,
    storage_bucket: storageBucket,
    storage_path: storagePath,
    mime_type: mimeType,
    file_size_bytes: fileSizeBytes,
    is_private: isPrivate,
    lead_id: leadIdResolved.value,
    client_id: clientIdResolved.value,
    property_id: projectIdResolved.value ?? propertyIdResolved.value,
    contract_id: contractIdResolved.value,
    invoice_id: invoiceIdResolved.value,
    project_property_id: projectIdResolved.value,
    portal_visibility,
    portal_is_published: portalIsPublished,
  };

  const { data, error } = await client
    .schema("crm")
    .from("documents")
    .insert(payload)
    .select(DOCUMENT_SELECT_COLUMNS)
    .single();

  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_document_insert_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  const mapped = await mapDocumentRow(client, data as Record<string, unknown>, {
    includeStorage: false,
    includeSigned: true,
    signedTtlSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS,
  });

  return jsonResponse(
    {
      ok: true,
      data: mapped,
      meta: {
        storage: "supabase.crm.documents",
        include_signed: true,
        signed_url_ttl_seconds: DEFAULT_SIGNED_URL_TTL_SECONDS,
      },
    },
    { status: 201 }
  );
};

export const PATCH: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<PatchDocumentBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationId = asText(body.organization_id);
  const documentId = asUuid(body.id);
  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (!documentId) return jsonResponse({ ok: false, error: "id_required" }, { status: 422 });

  const updatePayload: Record<string, unknown> = {};

  if (hasOwn(body, "scope")) {
    const scope = asDocumentScope(body.scope);
    if (!scope) return jsonResponse({ ok: false, error: "invalid_scope" }, { status: 422 });
    updatePayload.scope = scope;
  }
  if (hasOwn(body, "title")) {
    const title = asText(body.title);
    if (!title) return jsonResponse({ ok: false, error: "title_required" }, { status: 422 });
    updatePayload.title = title;
  }
  if (hasOwn(body, "storage_bucket")) {
    const storageBucket = asText(body.storage_bucket);
    if (!storageBucket) return jsonResponse({ ok: false, error: "storage_bucket_required" }, { status: 422 });
    updatePayload.storage_bucket = storageBucket;
  }
  if (hasOwn(body, "storage_path")) {
    const storagePath = asText(body.storage_path);
    if (!storagePath) return jsonResponse({ ok: false, error: "storage_path_required" }, { status: 422 });
    updatePayload.storage_path = storagePath;
  }
  if (hasOwn(body, "mime_type")) {
    updatePayload.mime_type = asText(body.mime_type);
  }
  if (hasOwn(body, "file_size_bytes")) {
    if (body.file_size_bytes == null) {
      updatePayload.file_size_bytes = null;
    } else {
      const fileSizeBytes = asFileSizeBytes(body.file_size_bytes);
      if (fileSizeBytes == null) return jsonResponse({ ok: false, error: "invalid_file_size_bytes" }, { status: 422 });
      updatePayload.file_size_bytes = fileSizeBytes;
    }
  }
  if (hasOwn(body, "is_private")) {
    const isPrivate = asBoolean(body.is_private);
    if (isPrivate == null) return jsonResponse({ ok: false, error: "invalid_is_private" }, { status: 422 });
    updatePayload.is_private = isPrivate;
  }

  if (hasOwn(body, "lead_id")) {
    const resolved = resolveNullableUuid(body.lead_id);
    if (!resolved.ok) return jsonResponse({ ok: false, error: "invalid_lead_id" }, { status: 422 });
    updatePayload.lead_id = resolved.value;
  }
  if (hasOwn(body, "client_id")) {
    const resolved = resolveNullableUuid(body.client_id);
    if (!resolved.ok) return jsonResponse({ ok: false, error: "invalid_client_id" }, { status: 422 });
    updatePayload.client_id = resolved.value;
  }
  if (hasOwn(body, "property_id")) {
    const resolved = resolveNullableUuid(body.property_id);
    if (!resolved.ok) return jsonResponse({ ok: false, error: "invalid_property_id" }, { status: 422 });
    updatePayload.property_id = resolved.value;
  }
  if (hasOwn(body, "contract_id")) {
    const resolved = resolveNullableUuid(body.contract_id);
    if (!resolved.ok) return jsonResponse({ ok: false, error: "invalid_contract_id" }, { status: 422 });
    updatePayload.contract_id = resolved.value;
  }
  if (hasOwn(body, "invoice_id")) {
    const resolved = resolveNullableUuid(body.invoice_id);
    if (!resolved.ok) return jsonResponse({ ok: false, error: "invalid_invoice_id" }, { status: 422 });
    updatePayload.invoice_id = resolved.value;
  }
  if (hasOwn(body, "project_property_id")) {
    const resolved = resolveNullableUuid(body.project_property_id);
    if (!resolved.ok) return jsonResponse({ ok: false, error: "invalid_project_property_id" }, { status: 422 });
    updatePayload.project_property_id = resolved.value;
    if (!hasOwn(body, "property_id")) {
      updatePayload.property_id = resolved.value;
    }
  }
  if (hasOwn(body, "portal_visibility")) {
    const portalVisibility = asPortalDocumentVisibility(body.portal_visibility);
    if (!portalVisibility) return jsonResponse({ ok: false, error: "invalid_portal_visibility" }, { status: 422 });
    updatePayload.portal_visibility = portalVisibility;
  }
  if (hasOwn(body, "portal_is_published")) {
    const portalIsPublished = asBoolean(body.portal_is_published);
    if (portalIsPublished == null) {
      return jsonResponse({ ok: false, error: "invalid_portal_is_published" }, { status: 422 });
    }
    updatePayload.portal_is_published = portalIsPublished;
  }

  if (!Object.keys(updatePayload).length) {
    return jsonResponse({ ok: false, error: "no_fields_to_update" }, { status: 422 });
  }

  if (!hasSupabaseServerClient()) {
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
        error: "db_document_update_error",
        details: error.message,
      },
      { status: 500 }
    );
  }
  if (!data) return jsonResponse({ ok: false, error: "document_not_found" }, { status: 404 });

  const mapped = await mapDocumentRow(client, data as Record<string, unknown>, {
    includeStorage: false,
    includeSigned: true,
    signedTtlSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS,
  });

  return jsonResponse({
    ok: true,
    data: mapped,
    meta: {
      storage: "supabase.crm.documents",
      include_signed: true,
      signed_url_ttl_seconds: DEFAULT_SIGNED_URL_TTL_SECONDS,
    },
  });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const body = await parseJsonBody<{ organization_id?: string; id?: string; delete_storage?: boolean }>(request);
  const organizationId = asText(body?.organization_id) ?? asText(url.searchParams.get("organization_id"));
  const documentId = asUuid(body?.id) ?? asUuid(url.searchParams.get("id"));
  const deleteStorage = asBoolean(body?.delete_storage ?? url.searchParams.get("delete_storage")) ?? false;

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (!documentId) return jsonResponse({ ok: false, error: "id_required" }, { status: 422 });

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: {
        id: documentId,
        deleted: true,
        storage_deleted: false,
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
        error: "db_document_read_error",
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
        error: "db_document_delete_error",
        details: deleteError.message,
      },
      { status: 500 }
    );
  }

  let storageDeleted = false;
  if (deleteStorage) {
    const bucket = asText((existing as Record<string, unknown>).storage_bucket);
    const path = asText((existing as Record<string, unknown>).storage_path);
    if (bucket && path) {
      try {
        const { error: removeError } = await client.storage.from(bucket).remove([path]);
        storageDeleted = !removeError;
      } catch {
        storageDeleted = false;
      }
    }
  }

  return jsonResponse({
    ok: true,
    data: {
      id: documentId,
      deleted: true,
      storage_deleted: storageDeleted,
    },
    meta: {
      storage: "supabase.crm.documents",
    },
  });
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "POST", "PATCH", "DELETE"]);
