import type { SupabaseClient } from "@supabase/supabase-js";
import { MEDIA_CATEGORIES, type MediaCategory } from "@/utils/crmProperties";

const DEFAULT_MEDIA_BUCKET = "properties";
const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const SUPABASE_PUBLIC_PATH = "/storage/v1/object/public/";
const SUPABASE_RENDER_PATH = "/storage/v1/render/image/public/";

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
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

const getMediaBucket = () =>
  asText(import.meta.env.CRM_PROPERTIES_MEDIA_BUCKET) ??
  asText(import.meta.env.PUBLIC_CRM_PROPERTIES_MEDIA_BUCKET) ??
  DEFAULT_MEDIA_BUCKET;

const getSupabaseHost = () => {
  const base =
    asText(import.meta.env.SUPABASE_URL) ?? asText(import.meta.env.PUBLIC_SUPABASE_URL) ?? null;
  if (!base) return null;
  try {
    return new URL(base).host;
  } catch {
    return null;
  }
};

const getMaxUploadBytes = () => {
  const raw = Number(import.meta.env.CRM_PROPERTIES_MEDIA_MAX_BYTES);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
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

const inferMimeType = (file: File, extension: string) => {
  const byMime = asText(file.type)?.toLowerCase() ?? "";
  if (ALLOWED_MIME.has(byMime)) return byMime;
  return MIME_BY_EXTENSION[extension] ?? null;
};

const isAlreadyExistsError = (message: string) => {
  const text = message.toLowerCase();
  return text.includes("already exists") || text.includes("duplicate");
};

const ensureBucketExists = async (client: SupabaseClient, bucket: string) => {
  const { error } = await client.storage.createBucket(bucket, { public: true });
  if (!error) return;
  if (isAlreadyExistsError(error.message)) return;
  throw new Error(`storage_bucket_error:${error.message}`);
};

export const buildPropertyStorageBasePath = (organizationId: string, propertyId: string) =>
  `org/${sanitizePathSegment(organizationId)}/property/${sanitizePathSegment(propertyId)}`;

const createDirectoryMarkers = async (
  client: SupabaseClient,
  bucket: string,
  basePath: string
) => {
  const folders = ["cover", ...MEDIA_CATEGORIES];
  for (const folder of folders) {
    const markerPath = `${basePath}/${folder}/.keep`;
    const { error } = await client.storage.from(bucket).upload(markerPath, new Uint8Array(0), {
      upsert: true,
      contentType: "text/plain",
    });
    if (error && !isAlreadyExistsError(error.message)) {
      throw new Error(`storage_marker_error:${error.message}`);
    }
  }
};

export const ensurePropertyStorageScaffold = async (
  client: SupabaseClient,
  organizationId: string,
  propertyId: string
) => {
  const bucket = getMediaBucket();
  await ensureBucketExists(client, bucket);
  const basePath = buildPropertyStorageBasePath(organizationId, propertyId);
  await createDirectoryMarkers(client, bucket, basePath);
  return { bucket, basePath };
};

export const validateMediaUploadFile = (file: File) => {
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

export const uploadPropertyMediaFile = async (
  client: SupabaseClient,
  options: {
    organizationId: string;
    propertyId: string;
    category: MediaCategory;
    file: File;
  }
) => {
  const validation = validateMediaUploadFile(options.file);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const scaffold = await ensurePropertyStorageScaffold(
    client,
    options.organizationId,
    options.propertyId
  );

  const timestamp = Date.now();
  const randomSuffix = crypto.randomUUID().slice(0, 8);
  const baseName = sanitizePathSegment(options.file.name.replace(/\.[^.]+$/, "")) || "media";
  const filePath = `${scaffold.basePath}/${options.category}/${timestamp}_${randomSuffix}_${baseName}.${validation.extension}`;

  const { error: uploadError } = await client.storage
    .from(scaffold.bucket)
    .upload(filePath, options.file, {
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

export const extractStorageObjectFromPublicUrl = (
  rawUrl: string
): { bucket: string; path: string } | null => {
  const text = asText(rawUrl);
  if (!text) return null;

  try {
    const parsed = new URL(text);
    const expectedHost = getSupabaseHost();
    if (expectedHost && parsed.host !== expectedHost) return null;

    const pathname = parsed.pathname || "";
    let prefix = "";
    if (pathname.includes(SUPABASE_PUBLIC_PATH)) {
      prefix = SUPABASE_PUBLIC_PATH;
    } else if (pathname.includes(SUPABASE_RENDER_PATH)) {
      prefix = SUPABASE_RENDER_PATH;
    } else {
      return null;
    }

    const index = pathname.indexOf(prefix);
    const remaining = pathname.slice(index + prefix.length);
    const firstSlash = remaining.indexOf("/");
    if (firstSlash <= 0) return null;

    const bucket = remaining.slice(0, firstSlash).trim();
    const path = remaining.slice(firstSlash + 1).trim();
    if (!bucket || !path) return null;
    return { bucket, path };
  } catch {
    return null;
  }
};

export const deleteStorageObjectsByPublicUrls = async (
  client: SupabaseClient,
  urls: string[]
): Promise<{ removed: number; failed: number; errors: string[] }> => {
  const grouped = new Map<string, Set<string>>();
  urls.forEach((url) => {
    const parsed = extractStorageObjectFromPublicUrl(url);
    if (!parsed) return;
    if (!grouped.has(parsed.bucket)) grouped.set(parsed.bucket, new Set());
    grouped.get(parsed.bucket)?.add(parsed.path);
  });

  let removed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const [bucket, pathsSet] of grouped.entries()) {
    const paths = Array.from(pathsSet);
    if (!paths.length) continue;
    const { data, error } = await client.storage.from(bucket).remove(paths);
    if (error) {
      failed += paths.length;
      errors.push(`${bucket}: ${error.message}`);
      continue;
    }
    const count = Array.isArray(data) ? data.length : 0;
    removed += count;
    if (count < paths.length) {
      failed += paths.length - count;
    }
  }

  return { removed, failed, errors };
};
