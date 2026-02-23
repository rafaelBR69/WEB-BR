import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";
import {
  CLIENT_DOCUMENT_KINDS,
  CLIENT_DOCUMENT_SUBJECT_TYPES,
  type ClientDocumentKind,
  type ClientDocumentSubjectType,
  uploadClientDocumentFile,
} from "@/utils/crmClientDocumentsStorage";
import { asText } from "@/utils/crmClients";

const toBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.toLowerCase().trim();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  return fallback;
};

const getClientIdFromParams = (params: Record<string, string | undefined>): string | null => {
  const raw = params.id;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
};

const isDocumentKind = (value: unknown): value is ClientDocumentKind =>
  typeof value === "string" && CLIENT_DOCUMENT_KINDS.includes(value as ClientDocumentKind);

const isSubjectType = (value: unknown): value is ClientDocumentSubjectType =>
  typeof value === "string" && CLIENT_DOCUMENT_SUBJECT_TYPES.includes(value as ClientDocumentSubjectType);

export const POST: APIRoute = async ({ params, request }) => {
  const clientId = getClientIdFromParams(params);
  if (!clientId) return jsonResponse({ ok: false, error: "client_id_required" }, { status: 400 });

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
  const title = asText(formData.get("title"));
  const documentKind = asText(formData.get("document_kind"));
  const subjectType = asText(formData.get("subject_type"));
  const isPrivate = toBoolean(formData.get("is_private"), true);
  const fileValue = formData.get("file");

  if (!isDocumentKind(documentKind)) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_or_missing_document_kind",
        details: `Usa uno de: ${CLIENT_DOCUMENT_KINDS.join(", ")}`,
      },
      { status: 422 }
    );
  }
  if (!(fileValue instanceof File)) {
    return jsonResponse({ ok: false, error: "file_required" }, { status: 422 });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  let currentQuery = client
    .schema("crm")
    .from("clients")
    .select("id, organization_id, client_type")
    .eq("id", clientId)
    .maybeSingle();
  if (organizationId) currentQuery = currentQuery.eq("organization_id", organizationId);

  const { data: current, error: currentError } = await currentQuery;
  if (currentError) {
    return jsonResponse(
      { ok: false, error: "db_client_read_error", details: currentError.message },
      { status: 500 }
    );
  }
  if (!current) return jsonResponse({ ok: false, error: "client_not_found" }, { status: 404 });

  const scopedOrganizationId = asText((current as Record<string, unknown>).organization_id);
  if (!scopedOrganizationId) {
    return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  }

  const resolvedSubjectType: ClientDocumentSubjectType = isSubjectType(subjectType)
    ? subjectType
    : "client";

  let uploaded: { bucket: string; path: string; publicUrl: string; mimeType: string; bytes: number };
  try {
    uploaded = await uploadClientDocumentFile(client, {
      organizationId: scopedOrganizationId,
      clientId,
      documentKind,
      subjectType: resolvedSubjectType,
      file: fileValue,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "storage_upload_failed";
    const status =
      detail.includes("unsupported_file_type") ||
      detail.includes("file_too_large") ||
      detail.includes("empty_file")
        ? 422
        : 500;
    let readableDetail = detail;
    if (detail.includes("unsupported_file_type")) {
      readableDetail = "Formato no permitido. Usa PDF, PNG, JPG/JPEG, WEBP, DOC o DOCX.";
    } else if (detail.includes("file_too_large")) {
      readableDetail = "Archivo demasiado grande. Maximo 15 MB.";
    } else if (detail.includes("empty_file")) {
      readableDetail = "El archivo esta vacio.";
    }
    return jsonResponse(
      {
        ok: false,
        error: "storage_upload_failed",
        details: readableDetail,
      },
      { status }
    );
  }

  const fallbackTitle = `${documentKind} - ${asText(fileValue.name) ?? "documento"}`;
  const { data: documentRow, error: insertError } = await client
    .schema("crm")
    .from("documents")
    .insert({
      organization_id: scopedOrganizationId,
      scope: "client",
      client_id: clientId,
      title: title ?? fallbackTitle,
      storage_bucket: uploaded.bucket,
      storage_path: uploaded.path,
      mime_type: uploaded.mimeType,
      file_size_bytes: uploaded.bytes,
      is_private: isPrivate,
    })
    .select(
      "id, organization_id, scope, client_id, title, storage_bucket, storage_path, mime_type, file_size_bytes, is_private, created_at"
    )
    .single();

  if (insertError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_document_insert_error",
        details: insertError.message,
      },
      { status: 500 }
    );
  }

  return jsonResponse(
    {
      ok: true,
      data: {
        ...(documentRow as Record<string, unknown>),
        subject_type: resolvedSubjectType,
        document_kind: documentKind,
        public_url: uploaded.publicUrl,
      },
      meta: {
        persisted: true,
        storage: "supabase.crm.documents",
        storage_bucket: uploaded.bucket,
        storage_path: uploaded.path,
        storage_url: uploaded.publicUrl,
        file_size: uploaded.bytes,
        mime_type: uploaded.mimeType,
      },
    },
    { status: 201 }
  );
};

export const GET: APIRoute = async () => methodNotAllowed(["POST"]);
export const PUT: APIRoute = async () => methodNotAllowed(["POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["POST"]);

