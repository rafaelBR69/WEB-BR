import type { SupabaseClient } from "@supabase/supabase-js";

export type ClientDocumentKind =
  | "dni_front"
  | "dni_back"
  | "nie_front"
  | "nie_back"
  | "passport"
  | "cif"
  | "bank_proof"
  | "reservation"
  | "contract"
  | "authorization"
  | "other";

export type ClientDocumentSubjectType = "client" | "provider" | "agency" | "other";

export const CLIENT_DOCUMENT_KINDS: ClientDocumentKind[] = [
  "dni_front",
  "dni_back",
  "nie_front",
  "nie_back",
  "passport",
  "cif",
  "bank_proof",
  "reservation",
  "contract",
  "authorization",
  "other",
];

export const CLIENT_DOCUMENT_SUBJECT_TYPES: ClientDocumentSubjectType[] = [
  "client",
  "provider",
  "agency",
  "other",
];

const DEFAULT_BUCKET = "crm-documents";
const DEFAULT_MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const ALLOWED_MIME = new Set(Object.values(MIME_BY_EXTENSION));
const ALLOWED_EXTENSIONS = new Set(Object.keys(MIME_BY_EXTENSION));

const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const sanitizePathSegment = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const isAlreadyExistsError = (message: string) => {
  const text = message.toLowerCase();
  return text.includes("already exists") || text.includes("duplicate");
};

const getBucket = () =>
  asText(import.meta.env.CRM_CLIENTS_DOCUMENTS_BUCKET) ??
  asText(import.meta.env.PUBLIC_CRM_CLIENTS_DOCUMENTS_BUCKET) ??
  DEFAULT_BUCKET;

const getMaxUploadBytes = () => {
  const raw = Number(import.meta.env.CRM_CLIENTS_DOCUMENTS_MAX_BYTES);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return DEFAULT_MAX_UPLOAD_BYTES;
};

const ensureBucketExists = async (client: SupabaseClient, bucket: string) => {
  const { error } = await client.storage.createBucket(bucket, { public: true });
  if (!error) return;
  if (isAlreadyExistsError(error.message)) return;
  throw new Error(`storage_bucket_error:${error.message}`);
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
  const byMime = asText(file.type)?.toLowerCase();
  if (byMime && ALLOWED_MIME.has(byMime)) return byMime;
  return MIME_BY_EXTENSION[extension] ?? null;
};

export const buildClientDocumentsBasePath = (organizationId: string, clientId: string) =>
  `org/${sanitizePathSegment(organizationId)}/client/${sanitizePathSegment(clientId)}`;

const createDirectoryMarkers = async (
  client: SupabaseClient,
  bucket: string,
  basePath: string
) => {
  for (const subject of CLIENT_DOCUMENT_SUBJECT_TYPES) {
    for (const kind of CLIENT_DOCUMENT_KINDS) {
      const markerPath = `${basePath}/${subject}/${kind}/.keep`;
      const { error } = await client.storage.from(bucket).upload(markerPath, new Uint8Array(0), {
        upsert: true,
        contentType: "text/plain",
      });
      if (error && !isAlreadyExistsError(error.message)) {
        throw new Error(`storage_marker_error:${error.message}`);
      }
    }
  }
};

export const ensureClientDocumentsScaffold = async (
  client: SupabaseClient,
  organizationId: string,
  clientId: string
) => {
  const bucket = getBucket();
  await ensureBucketExists(client, bucket);
  const basePath = buildClientDocumentsBasePath(organizationId, clientId);
  await createDirectoryMarkers(client, bucket, basePath);
  return { bucket, basePath };
};

export const validateClientDocumentUploadFile = (file: File) => {
  const extension = inferExtension(file);
  if (!extension) return { ok: false as const, error: "unsupported_file_type" };

  const mimeType = inferMimeType(file, extension);
  if (!mimeType || !ALLOWED_MIME.has(mimeType)) {
    return { ok: false as const, error: "unsupported_file_type" };
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false as const, error: "empty_file" };
  }

  const maxBytes = getMaxUploadBytes();
  if (file.size > maxBytes) {
    return { ok: false as const, error: "file_too_large", maxBytes };
  }

  return {
    ok: true as const,
    extension,
    mimeType,
    maxBytes,
  };
};

export const uploadClientDocumentFile = async (
  client: SupabaseClient,
  options: {
    organizationId: string;
    clientId: string;
    documentKind: ClientDocumentKind;
    subjectType: ClientDocumentSubjectType;
    file: File;
  }
) => {
  const validation = validateClientDocumentUploadFile(options.file);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const scaffold = await ensureClientDocumentsScaffold(client, options.organizationId, options.clientId);

  const timestamp = Date.now();
  const randomSuffix = crypto.randomUUID().slice(0, 8);
  const baseName = sanitizePathSegment(options.file.name.replace(/\.[^.]+$/, "")) || "document";
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const filePath = `${scaffold.basePath}/${options.subjectType}/${options.documentKind}/${yyyy}/${mm}/${timestamp}_${randomSuffix}_${baseName}.${validation.extension}`;

  const { error: uploadError } = await client.storage.from(scaffold.bucket).upload(filePath, options.file, {
    upsert: false,
    contentType: validation.mimeType,
    cacheControl: "3600",
  });

  if (uploadError) {
    throw new Error(`storage_upload_error:${uploadError.message}`);
  }

  const { data: publicData } = client.storage.from(scaffold.bucket).getPublicUrl(filePath);
  const publicUrl = asText(publicData.publicUrl);
  if (!publicUrl) {
    throw new Error("storage_public_url_error");
  }

  return {
    bucket: scaffold.bucket,
    path: filePath,
    publicUrl,
    mimeType: validation.mimeType,
    bytes: options.file.size,
  };
};

