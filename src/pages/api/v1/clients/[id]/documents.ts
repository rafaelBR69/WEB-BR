import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";
import {
  CLIENT_DOCUMENT_KINDS,
  CLIENT_DOCUMENT_SUBJECT_TYPES,
  type ClientDocumentKind,
  type ClientDocumentSubjectType,
} from "@/utils/crmClientDocumentsStorage";
import { asText } from "@/utils/crmClients";

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

const getClientIdFromParams = (params: Record<string, string | undefined>): string | null => {
  const raw = params.id;
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

export const GET: APIRoute = async ({ params, url }) => {
  const clientId = getClientIdFromParams(params);
  if (!clientId) return jsonResponse({ ok: false, error: "client_id_required" }, { status: 400 });

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: [],
      meta: {
        count: 0,
        storage: "mock_in_memory",
        next_step: "enable_supabase_for_client_documents",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const organizationId = asText(url.searchParams.get("organization_id"));

  let clientQuery = client
    .schema("crm")
    .from("clients")
    .select("id, organization_id")
    .eq("id", clientId)
    .maybeSingle();
  if (organizationId) clientQuery = clientQuery.eq("organization_id", organizationId);

  const { data: clientRow, error: clientError } = await clientQuery;
  if (clientError) {
    return jsonResponse(
      { ok: false, error: "db_client_read_error", details: clientError.message },
      { status: 500 }
    );
  }
  if (!clientRow) return jsonResponse({ ok: false, error: "client_not_found" }, { status: 404 });

  const scopedOrganizationId = asText((clientRow as Record<string, unknown>).organization_id);
  if (!scopedOrganizationId) {
    return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  }

  let docsQuery = client
    .schema("crm")
    .from("documents")
    .select(DOCUMENT_SELECT_COLUMNS)
    .eq("client_id", clientId)
    .eq("scope", "client")
    .order("created_at", { ascending: false });
  docsQuery = docsQuery.eq("organization_id", scopedOrganizationId);

  const { data, error } = await docsQuery;
  if (error) {
    return jsonResponse(
      { ok: false, error: "db_documents_read_error", details: error.message },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const mapped = rows.map((row) => {
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
  });

  return jsonResponse({
    ok: true,
    data: mapped,
    meta: {
      count: mapped.length,
      storage: "supabase.crm.documents",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET"]);

