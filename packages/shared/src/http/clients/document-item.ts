import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import {
  CLIENT_DOCUMENT_KINDS,
  CLIENT_DOCUMENT_SUBJECT_TYPES,
  type ClientDocumentKind,
  type ClientDocumentSubjectType,
  removeClientDocumentFile,
} from "@shared/clients/documentsStorage";
import { asText } from "@shared/clients/domain";
import {
  getSupabaseServerClient,
  hasSupabaseServerClient,
} from "@shared/supabase/server";
import { clientsMockFallbackDisabledResponse } from "@shared/http/clients/mockFallback";

type UpdateClientDocumentBody = {
  organization_id?: string;
  title?: string | null;
  is_private?: boolean | null;
};

const DOCUMENT_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "scope",
  "client_id",
  "title",
  "storage_bucket",
  "storage_path",
  "mime_type",
  "file_size_bytes",
  "is_private",
  "created_at",
].join(", ");

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

const getClientIdFromParams = (params: Record<string, string | undefined>): string | null => {
  const raw = params.id;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
};

const getDocumentIdFromParams = (params: Record<string, string | undefined>): string | null => {
  const raw = params.documentId;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
};

const parseDocumentPath = (
  path: string | null
): { subjectType: ClientDocumentSubjectType | null; documentKind: ClientDocumentKind | null } => {
  if (!path) return { subjectType: null, documentKind: null };
  const parts = path.split("/").filter(Boolean);
  const subjectCandidate = parts.length >= 5 ? parts[4] : null;
  const kindCandidate = parts.length >= 6 ? parts[5] : null;
  const subjectType = CLIENT_DOCUMENT_SUBJECT_TYPES.includes(
    subjectCandidate as ClientDocumentSubjectType
  )
    ? (subjectCandidate as ClientDocumentSubjectType)
    : null;
  const documentKind = CLIENT_DOCUMENT_KINDS.includes(kindCandidate as ClientDocumentKind)
    ? (kindCandidate as ClientDocumentKind)
    : null;
  return { subjectType, documentKind };
};

const mapDocumentRow = (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  row: Record<string, unknown>
) => {
  const storageBucket = asText(row.storage_bucket);
  const storagePath = asText(row.storage_path);
  const publicUrl =
    storageBucket && storagePath
      ? asText(client.storage.from(storageBucket).getPublicUrl(storagePath).data.publicUrl)
      : null;
  const parsed = parseDocumentPath(storagePath);

  return {
    id: asText(row.id),
    organization_id: asText(row.organization_id),
    scope: asText(row.scope),
    client_id: asText(row.client_id),
    title: asText(row.title),
    storage_bucket: storageBucket,
    storage_path: storagePath,
    public_url: publicUrl,
    mime_type: asText(row.mime_type),
    file_size_bytes:
      typeof row.file_size_bytes === "number"
        ? row.file_size_bytes
        : row.file_size_bytes
          ? Number(row.file_size_bytes)
          : null,
    is_private: row.is_private !== false,
    created_at: asText(row.created_at),
    subject_type: parsed.subjectType,
    document_kind: parsed.documentKind,
  };
};

const readScopedClient = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  clientId: string,
  organizationId: string | null
) => {
  let query = client
    .schema("crm")
    .from("clients")
    .select("id, organization_id")
    .eq("id", clientId)
    .maybeSingle();
  if (organizationId) query = query.eq("organization_id", organizationId);
  return query;
};

const readScopedDocument = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  organizationId: string,
  clientId: string,
  documentId: string
) =>
  client
    .schema("crm")
    .from("documents")
    .select(DOCUMENT_SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("scope", "client")
    .eq("client_id", clientId)
    .eq("id", documentId)
    .maybeSingle();

export const PATCH: APIRoute = async ({ params, request }) => {
  const clientId = getClientIdFromParams(params);
  const documentId = getDocumentIdFromParams(params);
  if (!clientId) return jsonResponse({ ok: false, error: "client_id_required" }, { status: 400 });
  if (!documentId) return jsonResponse({ ok: false, error: "document_id_required" }, { status: 400 });

  const body = await parseJsonBody<UpdateClientDocumentBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const wantsTitle = hasOwn(body, "title");
  const wantsPrivacy = hasOwn(body, "is_private");
  if (!wantsTitle && !wantsPrivacy) {
    return jsonResponse(
      {
        ok: false,
        error: "document_patch_empty",
        details: "Solo puedes actualizar title o is_private.",
      },
      { status: 422 }
    );
  }

  if (!hasSupabaseServerClient()) {
    return clientsMockFallbackDisabledResponse(
      "client_documents_requires_supabase",
      "Activa Supabase para editar documentos de clientes."
    );
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const requestedOrganizationId = asText(body.organization_id);
  const clientRow = await readScopedClient(client, clientId, requestedOrganizationId);
  if (clientRow.error) {
    return jsonResponse(
      { ok: false, error: "db_client_read_error", details: clientRow.error.message },
      { status: 500 }
    );
  }
  if (!clientRow.data) return jsonResponse({ ok: false, error: "client_not_found" }, { status: 404 });

  const organizationId =
    requestedOrganizationId ?? asText((clientRow.data as Record<string, unknown>).organization_id);
  if (!organizationId) {
    return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  }

  const currentDocument = await readScopedDocument(client, organizationId, clientId, documentId);
  if (currentDocument.error) {
    return jsonResponse(
      { ok: false, error: "db_document_read_error", details: currentDocument.error.message },
      { status: 500 }
    );
  }
  if (!currentDocument.data) return jsonResponse({ ok: false, error: "document_not_found" }, { status: 404 });

  const nextTitle = wantsTitle ? asText(body.title) : null;
  if (wantsTitle && !nextTitle) {
    return jsonResponse(
      {
        ok: false,
        error: "document_title_required",
        details: "El titulo no puede quedar vacio.",
      },
      { status: 422 }
    );
  }

  const updatePayload: Record<string, unknown> = {};
  if (wantsTitle) updatePayload.title = nextTitle;
  if (wantsPrivacy) updatePayload.is_private = body.is_private !== false;

  const updated = await client
    .schema("crm")
    .from("documents")
    .update(updatePayload)
    .eq("organization_id", organizationId)
    .eq("id", documentId)
    .eq("client_id", clientId)
    .eq("scope", "client")
    .select(DOCUMENT_SELECT_COLUMNS)
    .single();

  if (updated.error) {
    return jsonResponse(
      { ok: false, error: "db_document_update_error", details: updated.error.message },
      { status: 500 }
    );
  }

  return jsonResponse({
    ok: true,
    data: mapDocumentRow(client, (updated.data as Record<string, unknown>) ?? {}),
    meta: {
      persisted: true,
      storage: "supabase.crm.documents",
    },
  });
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const clientId = getClientIdFromParams(params);
  const documentId = getDocumentIdFromParams(params);
  if (!clientId) return jsonResponse({ ok: false, error: "client_id_required" }, { status: 400 });
  if (!documentId) return jsonResponse({ ok: false, error: "document_id_required" }, { status: 400 });

  if (!hasSupabaseServerClient()) {
    return clientsMockFallbackDisabledResponse(
      "client_documents_requires_supabase",
      "Activa Supabase para borrar documentos de clientes."
    );
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  let requestedOrganizationId: string | null = null;
  try {
    const body = await parseJsonBody<Record<string, unknown>>(request);
    requestedOrganizationId = asText(body?.organization_id);
  } catch {
    requestedOrganizationId = null;
  }

  const clientRow = await readScopedClient(client, clientId, requestedOrganizationId);
  if (clientRow.error) {
    return jsonResponse(
      { ok: false, error: "db_client_read_error", details: clientRow.error.message },
      { status: 500 }
    );
  }
  if (!clientRow.data) return jsonResponse({ ok: false, error: "client_not_found" }, { status: 404 });

  const organizationId =
    requestedOrganizationId ?? asText((clientRow.data as Record<string, unknown>).organization_id);
  if (!organizationId) {
    return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  }

  const currentDocument = await readScopedDocument(client, organizationId, clientId, documentId);
  if (currentDocument.error) {
    return jsonResponse(
      { ok: false, error: "db_document_read_error", details: currentDocument.error.message },
      { status: 500 }
    );
  }
  if (!currentDocument.data) return jsonResponse({ ok: false, error: "document_not_found" }, { status: 404 });

  const row = currentDocument.data as Record<string, unknown>;
  const storageBucket = asText(row.storage_bucket);
  const storagePath = asText(row.storage_path);
  if (!storageBucket || !storagePath) {
    return jsonResponse(
      {
        ok: false,
        error: "document_storage_reference_missing",
        details: "El documento no tiene referencia valida en storage.",
      },
      { status: 409 }
    );
  }

  try {
    await removeClientDocumentFile(client, { bucket: storageBucket, path: storagePath });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "storage_delete_failed",
        details: error instanceof Error ? error.message : "unknown_storage_delete_error",
      },
      { status: 500 }
    );
  }

  const deleted = await client
    .schema("crm")
    .from("documents")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", documentId)
    .eq("client_id", clientId)
    .eq("scope", "client");

  if (deleted.error) {
    return jsonResponse(
      { ok: false, error: "db_document_delete_error", details: deleted.error.message },
      { status: 500 }
    );
  }

  return jsonResponse({
    ok: true,
    data: {
      id: documentId,
      client_id: clientId,
    },
    meta: {
      deleted: true,
      storage: "supabase.crm.documents",
    },
  });
};

export const GET: APIRoute = async () => methodNotAllowed(["PATCH", "DELETE"]);
export const POST: APIRoute = async () => methodNotAllowed(["PATCH", "DELETE"]);
export const PUT: APIRoute = async () => methodNotAllowed(["PATCH", "DELETE"]);
