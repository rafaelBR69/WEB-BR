import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const DEFAULT_TARGET_BUCKET = "crm-portal-documents";
const PAGE_SIZE = 500;

const parseEnvFile = (absolutePath) => {
  if (!fs.existsSync(absolutePath)) return {};
  const out = {};
  const lines = fs.readFileSync(absolutePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (!key) continue;
    const hashIndex = value.indexOf(" #");
    if (hashIndex >= 0) value = value.slice(0, hashIndex).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
};

const envFromFiles = {
  ...parseEnvFile(path.join(ROOT, ".env")),
  ...parseEnvFile(path.join(ROOT, ".env.local")),
};

const asText = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const asEnv = (key) => asText(process.env[key] ?? envFromFiles[key] ?? null);

const readArg = (flagName) => {
  const prefix = `--${flagName}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${flagName}`);
  if (index >= 0) return process.argv[index + 1] || null;
  return null;
};

const hasFlag = (flagName) => process.argv.includes(`--${flagName}`);

const sanitizePathSegment = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const isAlreadyExistsError = (message) => {
  const normalized = String(message ?? "").toLowerCase();
  return normalized.includes("already exists") || normalized.includes("duplicate");
};

const normalizeVisibility = (value) => {
  if (value === "agent" || value === "client" || value === "both" || value === "crm_only") return value;
  return "crm_only";
};

const visibilityToKind = (value) => {
  const visibility = normalizeVisibility(value);
  if (visibility === "agent") return "agency_kit";
  if (visibility === "client") return "client_kit";
  if (visibility === "both") return "shared_kit";
  return "other";
};

const asBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  return fallback;
};

const fetchAllDocuments = async (client, organizationId) => {
  const rows = [];
  let from = 0;

  while (true) {
    let query = client
      .schema("crm")
      .from("documents")
      .select(
        "id, organization_id, title, storage_bucket, storage_path, mime_type, is_private, portal_visibility, portal_is_published, project_property_id, created_at"
      )
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (organizationId) query = query.eq("organization_id", organizationId);

    const { data, error } = await query;
    if (error) throw new Error(`db_documents_read_error: ${error.message}`);

    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
};

const ensurePrivateBucket = async (client, bucket) => {
  const { error: createError } = await client.storage.createBucket(bucket, { public: false });
  if (createError && !isAlreadyExistsError(createError.message)) {
    throw new Error(`storage_bucket_create_error:${createError.message}`);
  }

  const { error: updateError } = await client.storage.updateBucket(bucket, { public: false });
  if (updateError) throw new Error(`storage_bucket_update_error:${updateError.message}`);
};

const buildTargetPath = (row, sourcePath) => {
  const org = sanitizePathSegment(row.organization_id);
  const project = sanitizePathSegment(row.project_property_id || "unassigned");
  const kind = visibilityToKind(row.portal_visibility);
  const createdAt = asText(row.created_at);
  const date = createdAt ? new Date(createdAt) : new Date();
  const yyyy = String(Number.isNaN(date.getTime()) ? new Date().getUTCFullYear() : date.getUTCFullYear());
  const mm = String(
    Number.isNaN(date.getTime()) ? new Date().getUTCMonth() + 1 : date.getUTCMonth() + 1
  ).padStart(2, "0");
  const id = sanitizePathSegment(row.id);

  const rawName = asText(sourcePath?.split("/").pop()) ?? "document";
  const dotIndex = rawName.lastIndexOf(".");
  const base = dotIndex > 0 ? rawName.slice(0, dotIndex) : rawName;
  const ext = dotIndex > 0 ? rawName.slice(dotIndex) : "";
  const safeName = sanitizePathSegment(base) || "document";

  return `org/${org}/project/${project}/portal/${kind}/migrated/${yyyy}/${mm}/${id}_${safeName}${ext}`;
};

const run = async () => {
  const organizationId = asText(readArg("organization-id"));
  const targetBucket =
    asText(readArg("target-bucket")) ??
    asEnv("CRM_PORTAL_DOCUMENTS_BUCKET") ??
    asEnv("PUBLIC_CRM_PORTAL_DOCUMENTS_BUCKET") ??
    DEFAULT_TARGET_BUCKET;
  const limitRaw = Number(readArg("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : null;
  const apply = hasFlag("apply");
  const deleteSource = hasFlag("delete-source");

  const supabaseUrl = asEnv("SUPABASE_URL") ?? asEnv("PUBLIC_SUPABASE_URL");
  const serviceRoleKey = asEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("missing_supabase_credentials (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const allRows = await fetchAllDocuments(client, organizationId);
  const portalRows = allRows.filter((row) => {
    const hasProject = Boolean(asText(row.project_property_id));
    const visibility = normalizeVisibility(row.portal_visibility);
    const isPublished = asBoolean(row.portal_is_published, false);
    return hasProject || visibility !== "crm_only" || isPublished;
  });

  const candidates = portalRows
    .filter((row) => asText(row.storage_bucket) && asText(row.storage_path))
    .slice(0, limit ?? portalRows.length);

  const summary = {
    mode: apply ? "apply" : "dry-run",
    organization_id: organizationId ?? "all",
    target_bucket: targetBucket,
    total_documents: allRows.length,
    portal_documents: portalRows.length,
    candidates: candidates.length,
    delete_source: deleteSource,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (!candidates.length) {
    console.log("No hay documentos portal para migrar.");
    return;
  }

  if (!apply) {
    console.log("Primeros 25 documentos candidatos:");
    candidates.slice(0, 25).forEach((row) => {
      const sourceBucket = asText(row.storage_bucket);
      const sourcePath = asText(row.storage_path);
      const visibility = normalizeVisibility(row.portal_visibility);
      const nextPath = sourceBucket === targetBucket ? sourcePath : buildTargetPath(row, sourcePath);
      console.log(
        ` - ${row.id} | ${sourceBucket}/${sourcePath} -> ${targetBucket}/${nextPath} | visibility=${visibility}`
      );
    });
    console.log("Ejecuta con --apply para realizar la migracion.");
    return;
  }

  await ensurePrivateBucket(client, targetBucket);

  const metrics = {
    moved: 0,
    marked_private_only: 0,
    source_deleted: 0,
    failed: 0,
    skipped: 0,
  };

  for (const row of candidates) {
    const rowId = asText(row.id);
    const rowOrgId = asText(row.organization_id);
    const sourceBucket = asText(row.storage_bucket);
    const sourcePath = asText(row.storage_path);
    const isPrivate = asBoolean(row.is_private, true);

    if (!rowId || !rowOrgId || !sourceBucket || !sourcePath) {
      metrics.skipped += 1;
      continue;
    }

    try {
      const sameBucket = sourceBucket === targetBucket;
      const targetPath = sameBucket ? sourcePath : buildTargetPath(row, sourcePath);
      let movedStorage = false;

      if (!sameBucket) {
        const { data: downloaded, error: downloadError } = await client.storage
          .from(sourceBucket)
          .download(sourcePath);
        if (downloadError) throw new Error(`download_error:${downloadError.message}`);

        const bytes = new Uint8Array(await downloaded.arrayBuffer());
        const { error: uploadError } = await client.storage.from(targetBucket).upload(targetPath, bytes, {
          upsert: false,
          contentType: asText(row.mime_type) ?? undefined,
          cacheControl: "3600",
        });
        if (uploadError && !isAlreadyExistsError(uploadError.message)) {
          throw new Error(`upload_error:${uploadError.message}`);
        }
        movedStorage = true;
      }

      const updatePayload = {
        storage_bucket: targetBucket,
        storage_path: targetPath,
        is_private: true,
      };

      const { error: updateError } = await client
        .schema("crm")
        .from("documents")
        .update(updatePayload)
        .eq("organization_id", rowOrgId)
        .eq("id", rowId);

      if (updateError) throw new Error(`db_update_error:${updateError.message}`);

      if (movedStorage) metrics.moved += 1;
      else if (!isPrivate) metrics.marked_private_only += 1;
      else metrics.skipped += 1;

      if (deleteSource && movedStorage) {
        const { error: deleteError } = await client.storage.from(sourceBucket).remove([sourcePath]);
        if (!deleteError) metrics.source_deleted += 1;
      }
    } catch (error) {
      metrics.failed += 1;
      const details = error instanceof Error ? error.message : String(error);
      console.error(`migration_failed:${rowId}:${details}`);
    }
  }

  console.log(JSON.stringify(metrics, null, 2));
};

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`migration_failed: ${message}`);
  process.exit(1);
});
