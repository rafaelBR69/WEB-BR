import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const SUPABASE_PUBLIC_PATH = "/storage/v1/object/public/";
const SUPABASE_RENDER_PATH = "/storage/v1/render/image/public/";
const MEDIA_CATEGORIES = [
  "cover",
  "living",
  "bedroom",
  "kitchen",
  "bathroom",
  "exterior",
  "interior",
  "views",
  "floorplan",
];

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

const extractStorageObjectFromPublicUrl = (rawUrl, expectedHost = null) => {
  const text = asText(rawUrl);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (expectedHost && parsed.host !== expectedHost) return null;

    const pathname = parsed.pathname || "";
    let prefix = "";
    if (pathname.includes(SUPABASE_PUBLIC_PATH)) prefix = SUPABASE_PUBLIC_PATH;
    else if (pathname.includes(SUPABASE_RENDER_PATH)) prefix = SUPABASE_RENDER_PATH;
    else return null;

    const index = pathname.indexOf(prefix);
    const remaining = pathname.slice(index + prefix.length);
    const firstSlash = remaining.indexOf("/");
    if (firstSlash <= 0) return null;
    const bucket = remaining.slice(0, firstSlash).trim();
    const objectPath = remaining.slice(firstSlash + 1).trim();
    if (!bucket || !objectPath) return null;
    return { bucket, path: objectPath };
  } catch {
    return null;
  }
};

const collectMediaUrls = (media) => {
  const urls = [];
  if (!media || typeof media !== "object") return urls;
  const cover = media.cover;
  if (typeof cover === "string") urls.push(cover);
  if (cover && typeof cover === "object" && typeof cover.url === "string") urls.push(cover.url);

  const gallery = media.gallery && typeof media.gallery === "object" ? media.gallery : {};
  for (const list of Object.values(gallery)) {
    if (!Array.isArray(list)) continue;
    list.forEach((item) => {
      if (typeof item === "string") urls.push(item);
      else if (item && typeof item === "object" && typeof item.url === "string") urls.push(item.url);
    });
  }
  return urls;
};

const listFolderFiles = async (client, bucket, folderPath) => {
  const files = [];
  const limit = 100;
  let offset = 0;
  while (true) {
    const { data, error } = await client.storage.from(bucket).list(folderPath, {
      limit,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`${folderPath}: ${error.message}`);
    const rows = data ?? [];
    rows.forEach((entry) => {
      const name = asText(entry?.name);
      if (!name) return;
      if (name.endsWith("/")) return;
      files.push(`${folderPath}/${name}`);
    });
    if (rows.length < limit) break;
    offset += limit;
  }
  return files;
};

const fetchAllProperties = async (client, organizationId) => {
  const pageSize = 500;
  let from = 0;
  const rows = [];

  while (true) {
    let query = client
      .schema("crm")
      .from("properties")
      .select("id, organization_id, media")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (organizationId) query = query.eq("organization_id", organizationId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return rows;
};

const chunk = (items, size) => {
  const output = [];
  for (let i = 0; i < items.length; i += size) {
    output.push(items.slice(i, i + size));
  }
  return output;
};

const run = async () => {
  const organizationId = asText(readArg("organization-id") ?? asEnv("CRM_ORGANIZATION_ID"));
  const bucket =
    asText(readArg("bucket") ?? asEnv("CRM_PROPERTIES_MEDIA_BUCKET") ?? asEnv("PUBLIC_CRM_PROPERTIES_MEDIA_BUCKET")) ??
    "properties";
  const apply = hasFlag("apply");

  const supabaseUrl = asEnv("SUPABASE_URL") ?? asEnv("PUBLIC_SUPABASE_URL");
  const serviceRoleKey = asEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("missing_supabase_credentials (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
  }

  const supabaseHost = new URL(supabaseUrl).host;
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const rows = await fetchAllProperties(client, organizationId);
  const referencedPaths = new Set();
  const managedBasePaths = new Set();

  rows.forEach((row) => {
    const orgId = sanitizePathSegment(row.organization_id);
    const propertyId = sanitizePathSegment(row.id);
    if (orgId && propertyId) {
      managedBasePaths.add(`org/${orgId}/property/${propertyId}`);
    }

    const urls = collectMediaUrls(row.media);
    urls.forEach((url) => {
      const parsed = extractStorageObjectFromPublicUrl(url, supabaseHost);
      if (!parsed) return;
      if (parsed.bucket !== bucket) return;
      referencedPaths.add(parsed.path);
    });
  });

  const existingPaths = new Set();
  for (const basePath of managedBasePaths) {
    for (const category of MEDIA_CATEGORIES) {
      const folder = `${basePath}/${category}`;
      const files = await listFolderFiles(client, bucket, folder);
      files.forEach((item) => existingPaths.add(item));
    }
  }

  const orphanPaths = Array.from(existingPaths).filter(
    (pathValue) => !referencedPaths.has(pathValue) && !pathValue.endsWith("/.keep")
  );

  const summary = {
    organizationId: organizationId ?? "all",
    bucket,
    properties: rows.length,
    managedBasePaths: managedBasePaths.size,
    referencedObjects: referencedPaths.size,
    existingObjects: existingPaths.size,
    orphanObjects: orphanPaths.length,
    mode: apply ? "apply" : "dry-run",
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!orphanPaths.length) {
    console.log("No hay huerfanos para limpiar.");
    return;
  }

  if (!apply) {
    console.log("Primeros 50 huerfanos detectados:");
    orphanPaths.slice(0, 50).forEach((pathValue) => console.log(` - ${pathValue}`));
    console.log("Ejecuta con --apply para borrar.");
    return;
  }

  let removed = 0;
  let failed = 0;
  for (const pack of chunk(orphanPaths, 100)) {
    const { data, error } = await client.storage.from(bucket).remove(pack);
    if (error) {
      failed += pack.length;
      console.error(`Error borrando lote: ${error.message}`);
      continue;
    }
    const count = Array.isArray(data) ? data.length : 0;
    removed += count;
    if (count < pack.length) failed += pack.length - count;
  }

  console.log(
    JSON.stringify(
      {
        removed,
        failed,
      },
      null,
      2
    )
  );
};

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`cleanup_failed: ${message}`);
  process.exit(1);
});

