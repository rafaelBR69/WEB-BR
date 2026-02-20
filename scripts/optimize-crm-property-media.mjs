import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const SUPABASE_PUBLIC_PATH = "/storage/v1/object/public/";
const SUPABASE_RENDER_PATH = "/storage/v1/render/image/public/";
const DEFAULT_MEDIA_BUCKET = "properties";
const DEFAULT_TARGET_PREFIX = "optimized/v1";
const DEFAULT_PRIMARY_VARIANT = "hero";
const DEFAULT_PATH_STRATEGY = "hashed";
const DEFAULT_VARIANT_PLACEMENT = "suffix";
const DEFAULT_REPORTS_DIR = path.join(ROOT, "scripts", "media-optimizer", "reports");
const DEFAULT_JOBS_DIR = path.join(ROOT, "scripts", "media-optimizer", "jobs");
const DEFAULT_JOB_FILE = path.join(DEFAULT_JOBS_DIR, "default.json");
const DEFAULT_VARIANTS = [
  { name: "card", width: 960, quality: 72 },
  { name: "hero", width: 1600, quality: 76 },
];
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".tif",
  ".tiff",
  ".gif",
  ".avif",
]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HELP_TEXT = `
Uso:
  node scripts/optimize-crm-property-media.mjs [opciones]

Opciones principales:
  --apply                      Ejecuta cambios (por defecto: dry-run)
  --dry-run                    Simula sin subir ni actualizar DB
  --job-file <ruta>            Carga configuracion JSON del job
  --organization-id <uuid>     Scope de organizacion CRM (requerido)
  --legacy-codes <A,B,C>       Filtra por legacy_code
  --property-ids <id1,id2>     Filtra por ids CRM
  --limit <n>                  Limita propiedades procesadas
  --bucket <nombre>            Bucket origen media (default: properties)
  --target-bucket <nombre>     Bucket destino optimizados (default: bucket origen)
  --target-prefix <ruta>       Carpeta destino en bucket (default: optimized/v1)
  --path-strategy <modo>       hashed | project_scoped (default: hashed)
  --variant-placement <modo>   suffix | folder (default: suffix)
  --source-map-report <ruta>   Reporte previo para mapear URL optimizada -> URL original
                               Usa 'latest' para tomar el ultimo reporte disponible
  --variants <spec>            Formato: nombre:ancho:calidad,...
                               Ejemplo: thumb:480:68,card:960:72,hero:1600:76
  --primary-variant <nombre>   Variante que se guarda en media.url (default: hero)
  --overwrite                  Fuerza regeneracion aunque ya este optimizado
  --report-file <ruta>         Ruta de reporte JSON (default: scripts/media-optimizer/reports)
  --help                       Muestra esta ayuda

Ejemplos:
  node scripts/optimize-crm-property-media.mjs --dry-run --organization-id <ORG_UUID>
  node scripts/optimize-crm-property-media.mjs --apply --job-file scripts/media-optimizer/jobs/default.json
  node scripts/optimize-crm-property-media.mjs --apply --path-strategy project_scoped --variant-placement folder
  npm run properties:media-optimize -- -- --apply --organization-id <ORG_UUID>
`.trim();

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

const asBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.toLowerCase().trim();
    if (lower === "true" || lower === "1" || lower === "yes" || lower === "on") return true;
    if (lower === "false" || lower === "0" || lower === "no" || lower === "off") return false;
  }
  return fallback;
};

const asPositiveInteger = (value) => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
};

const asEnv = (key) => asText(process.env[key] ?? envFromFiles[key] ?? null);

const hasFlag = (flagName) => process.argv.includes(`--${flagName}`);

const readArg = (flagName) => {
  const prefix = `--${flagName}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${flagName}`);
  if (index >= 0) return process.argv[index + 1] || null;
  return null;
};

const splitList = (raw) =>
  String(raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const normalizeLegacyCode = (value) => {
  const text = asText(value);
  return text ? text.toUpperCase() : null;
};

const sanitizePathSegment = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const normalizePrefix = (value) =>
  String(value ?? "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

const toPathSegments = (value) =>
  String(value ?? "")
    .split("/")
    .map((entry) => sanitizePathSegment(entry))
    .filter((entry) => entry.length > 0);

const deepClone = (value) => JSON.parse(JSON.stringify(value ?? {}));

const readJsonFile = (absolutePath) => {
  const raw = fs.readFileSync(absolutePath, "utf8");
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`job_file_invalid_object:${absolutePath}`);
  }
  return parsed;
};

const resolveJobFilePath = (raw) => {
  const explicit = asText(raw);
  if (!explicit) {
    return fs.existsSync(DEFAULT_JOB_FILE) ? DEFAULT_JOB_FILE : null;
  }

  const candidates = [];
  const rawAsPath = path.isAbsolute(explicit) ? explicit : path.join(ROOT, explicit);
  candidates.push(rawAsPath);

  const named = explicit.endsWith(".json") ? explicit : `${explicit}.json`;
  const namedInJobs = path.isAbsolute(named) ? named : path.join(DEFAULT_JOBS_DIR, named);
  candidates.push(namedInJobs);

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return found ?? candidates[0];
};

const normalizeVariants = (value) => {
  if (!Array.isArray(value)) return null;
  const unique = new Set();
  const out = [];

  value.forEach((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const name = sanitizePathSegment(entry.name);
    const width = asPositiveInteger(entry.width);
    const qualityRaw = asPositiveInteger(entry.quality);
    const quality = qualityRaw == null ? 76 : Math.max(30, Math.min(95, qualityRaw));
    if (!name || !width) return;
    if (unique.has(name)) return;
    unique.add(name);
    out.push({ name, width, quality });
  });

  return out.length ? out : null;
};

const parseVariantsArg = (raw) => {
  const text = asText(raw);
  if (!text) return null;
  const entries = splitList(text);
  const parsed = entries
    .map((entry) => {
      const [nameRaw, widthRaw, qualityRaw] = entry.split(":");
      const name = sanitizePathSegment(nameRaw);
      const width = asPositiveInteger(widthRaw);
      const qualityValue = asPositiveInteger(qualityRaw);
      const quality = qualityValue == null ? 76 : Math.max(30, Math.min(95, qualityValue));
      if (!name || !width) return null;
      return { name, width, quality };
    })
    .filter((item) => item !== null);

  if (!parsed.length) return null;
  const unique = new Map();
  parsed.forEach((variant) => {
    unique.set(variant.name, variant);
  });
  return Array.from(unique.values());
};

const resolvePathStrategy = (value) => {
  const mode = asText(value)?.toLowerCase();
  if (mode === "hashed" || mode === "project_scoped") return mode;
  return null;
};

const resolveVariantPlacement = (value) => {
  const mode = asText(value)?.toLowerCase();
  if (mode === "suffix" || mode === "folder") return mode;
  return null;
};

const readMediaUrl = (value) => {
  if (typeof value === "string") return asText(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return asText(value.url);
  }
  return null;
};

const setMediaUrl = (container, key, nextUrl) => {
  const current = container[key];
  if (typeof current === "string") {
    container[key] = nextUrl;
    return;
  }
  if (current && typeof current === "object" && !Array.isArray(current)) {
    container[key] = { ...current, url: nextUrl };
    return;
  }
  container[key] = nextUrl;
};

const extractMediaPointers = (media) => {
  const pointers = [];
  if (!media || typeof media !== "object" || Array.isArray(media)) return pointers;

  const coverUrl = readMediaUrl(media.cover);
  if (coverUrl) {
    pointers.push({
      category: "cover",
      location: "cover",
      sourceUrl: coverUrl,
      apply: (nextUrl) => setMediaUrl(media, "cover", nextUrl),
    });
  }

  const gallery = media.gallery;
  if (!gallery || typeof gallery !== "object" || Array.isArray(gallery)) return pointers;

  Object.entries(gallery).forEach(([rawCategory, rawItems]) => {
    if (!Array.isArray(rawItems)) return;
    const categoryNormalized = sanitizePathSegment(rawCategory) || "gallery";
    const category = categoryNormalized || "gallery";

    rawItems.forEach((item, index) => {
      const url = readMediaUrl(item);
      if (!url) return;
      pointers.push({
        category,
        location: `gallery.${rawCategory}[${index}]`,
        sourceUrl: url,
        apply: (nextUrl) => {
          const list = gallery[rawCategory];
          if (!Array.isArray(list)) return;
          const current = list[index];
          if (typeof current === "string") {
            list[index] = nextUrl;
            return;
          }
          if (current && typeof current === "object" && !Array.isArray(current)) {
            list[index] = { ...current, url: nextUrl };
            return;
          }
          list[index] = nextUrl;
        },
      });
    });
  });

  return pointers;
};

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

const decodeStoragePath = (value) => {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
};

const isSupportedImagePath = (objectPath) => {
  const ext = path.extname(String(objectPath ?? "")).toLowerCase();
  return SUPPORTED_IMAGE_EXTENSIONS.has(ext);
};

const isOptimizedTargetPath = (objectPath, normalizedPrefix, pathStrategy) => {
  if (!normalizedPrefix) return false;
  const pathValue = String(objectPath ?? "").replace(/^\/+/, "");
  if (pathStrategy === "project_scoped") {
    return pathValue.startsWith(`${normalizedPrefix}/`) || pathValue.includes(`/${normalizedPrefix}/`);
  }
  return pathValue.startsWith(`${normalizedPrefix}/`);
};

const formatSupabaseError = (error) => {
  if (!error) return "unknown_error";
  const message = String(error.message ?? "unknown_error");
  const details = error.details ? `details=${String(error.details)}` : null;
  const hint = error.hint ? `hint=${String(error.hint)}` : null;
  return [message, details, hint].filter(Boolean).join(" | ");
};

const downloadStorageObject = async (client, bucket, objectPath) => {
  const attempts = Array.from(new Set([objectPath, decodeStoragePath(objectPath)]));
  let lastError = "download_failed";

  for (const candidatePath of attempts) {
    const { data, error } = await client.storage.from(bucket).download(candidatePath);
    if (!error && data) {
      return {
        blob: data,
        objectPath: candidatePath,
      };
    }
    lastError = error ? error.message : "download_failed";
  }

  throw new Error(lastError);
};

const splitProjectRootAndRest = (sourceSegments) => {
  if (
    sourceSegments.length >= 4 &&
    sourceSegments[0] === "org" &&
    sourceSegments[2] === "property"
  ) {
    return {
      root: sourceSegments.slice(0, 4),
      rest: sourceSegments.slice(4),
    };
  }

  if (sourceSegments.length >= 1) {
    return {
      root: [sourceSegments[0]],
      rest: sourceSegments.slice(1),
    };
  }

  return {
    root: ["misc"],
    rest: [],
  };
};

const buildTargetPath = (options) => {
  const {
    pathStrategy,
    targetPrefix,
    sourceBucket,
    sourceObjectPath,
    variantName,
    variantPlacement,
  } = options;

  const decodedPath = decodeStoragePath(sourceObjectPath).replace(/^\/+/, "");
  const fullSourceKey = `${sourceBucket}/${decodedPath}`;
  const sourceExt = path.extname(decodedPath).toLowerCase();
  const base = sanitizePathSegment(path.basename(decodedPath, sourceExt)) || "image";

  if (pathStrategy === "hashed") {
    const hash = crypto.createHash("sha1").update(fullSourceKey).digest("hex").slice(0, 12);
    return `${targetPrefix}/${hash.slice(0, 2)}/${hash}-${base}-${variantName}.webp`;
  }

  const sourceSegments = toPathSegments(decodedPath);
  const fileName = sourceSegments.pop() ?? "image";
  const fileExt = path.extname(fileName).toLowerCase();
  const fileBase = sanitizePathSegment(path.basename(fileName, fileExt)) || base;
  const prefixSegments = toPathSegments(normalizePrefix(targetPrefix));
  const { root, rest } = splitProjectRootAndRest(sourceSegments);
  const restDir = rest;

  const output = [...root, ...prefixSegments, ...restDir];
  if (variantPlacement === "folder") {
    output.push(variantName, `${fileBase}.webp`);
  } else {
    output.push(`${fileBase}-${variantName}.webp`);
  }
  return output.join("/");
};

const uploadOptimizedVariant = async (client, options) => {
  const { targetBucket, targetPath, buffer } = options;
  const { error } = await client.storage.from(targetBucket).upload(targetPath, buffer, {
    upsert: true,
    contentType: "image/webp",
    cacheControl: "31536000",
  });
  if (error) {
    throw new Error(`upload_failed:${formatSupabaseError(error)}`);
  }

  const { data } = client.storage.from(targetBucket).getPublicUrl(targetPath);
  const publicUrl = asText(data?.publicUrl);
  if (!publicUrl) {
    throw new Error("public_url_failed");
  }

  return publicUrl;
};

const optimizeImageBuffer = async (sourceBuffer, variants) => {
  const base = sharp(sourceBuffer, { failOnError: false }).rotate();
  const metadata = await base.metadata();
  const sourceWidth = asPositiveInteger(metadata.width);

  const outputs = [];
  for (const variant of variants) {
    const resizeWidth = sourceWidth ? Math.min(sourceWidth, variant.width) : variant.width;
    const next = base
      .clone()
      .resize({ width: resizeWidth, withoutEnlargement: true })
      .webp({
        quality: variant.quality,
        effort: 5,
        smartSubsample: true,
      });

    const optimized = await next.toBuffer();
    outputs.push({
      name: variant.name,
      width: resizeWidth,
      quality: variant.quality,
      bytes: optimized.length,
      buffer: optimized,
    });
  }

  return {
    metadata: {
      width: sourceWidth,
      height: asPositiveInteger(metadata.height),
      format: asText(metadata.format),
      source_bytes: sourceBuffer.length,
    },
    outputs,
  };
};

const fetchProperties = async (client, filters) => {
  const pageSize = 300;
  const collectRows = async (applyLegacyFilter) => {
    const rows = [];
    let from = 0;

    while (true) {
      let query = client
        .schema("crm")
        .from("properties")
        .select("id, organization_id, legacy_code, media")
        .eq("organization_id", filters.organizationId)
        .order("legacy_code", { ascending: true })
        .range(from, from + pageSize - 1);

      if (filters.propertyIds.length) {
        query = query.in("id", filters.propertyIds);
      }
      if (applyLegacyFilter && filters.legacyCodes.length) {
        query = query.in("legacy_code", filters.legacyCodes);
      }

      const { data, error } = await query;
      if (error) throw new Error(`fetch_properties_failed:${formatSupabaseError(error)}`);

      const batch = data ?? [];
      rows.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }

    return rows;
  };

  const requestedLegacyCodes = new Map();
  filters.legacyCodes.forEach((code) => {
    const normalized = normalizeLegacyCode(code);
    if (!normalized || requestedLegacyCodes.has(normalized)) return;
    requestedLegacyCodes.set(normalized, code);
  });

  let rows = await collectRows(true);
  let usedLegacyFallback = false;

  if (requestedLegacyCodes.size > 0 && rows.length === 0) {
    usedLegacyFallback = true;
    const requestedNormalized = new Set(requestedLegacyCodes.keys());
    const orgScopedRows = await collectRows(false);
    rows = orgScopedRows.filter((row) => {
      const normalized = normalizeLegacyCode(row.legacy_code);
      return Boolean(normalized && requestedNormalized.has(normalized));
    });
  }

  const matchedLegacyCodes = new Set(
    rows.map((row) => normalizeLegacyCode(row.legacy_code)).filter((value) => Boolean(value))
  );
  const unmatchedLegacyCodes = Array.from(requestedLegacyCodes.entries())
    .filter(([normalized]) => !matchedLegacyCodes.has(normalized))
    .map(([, original]) => original);

  return {
    rows: filters.limit ? rows.slice(0, filters.limit) : rows,
    unmatchedLegacyCodes,
    usedLegacyFallback,
  };
};

const ensureDirectory = (absolutePath) => {
  fs.mkdirSync(absolutePath, { recursive: true });
};

const buildReportPath = (rawReportPath) => {
  const explicit = asText(rawReportPath);
  if (explicit) {
    const asAbsolute = path.isAbsolute(explicit) ? explicit : path.join(ROOT, explicit);
    const dir = path.dirname(asAbsolute);
    ensureDirectory(dir);
    return asAbsolute;
  }
  ensureDirectory(DEFAULT_REPORTS_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(DEFAULT_REPORTS_DIR, `media-optimize-${stamp}.json`);
};

const resolveSourceMapReportPath = (rawValue) => {
  const input = asText(rawValue);
  if (!input) return null;

  if (input.toLowerCase() === "latest") {
    const candidates = fs
      .readdirSync(DEFAULT_REPORTS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^media-optimize-.*\.json$/i.test(entry.name))
      .map((entry) => path.join(DEFAULT_REPORTS_DIR, entry.name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

    let fallbackApplyWithSamples = null;

    for (const reportPath of candidates) {
      try {
        const parsed = readJsonFile(reportPath);
        const mode = asText(parsed?.summary?.mode)?.toLowerCase();
        const samples = Array.isArray(parsed?.optimized_samples) ? parsed.optimized_samples : [];
        if (mode === "apply" && samples.length > 0) {
          if (!fallbackApplyWithSamples) {
            fallbackApplyWithSamples = reportPath;
          }

          const hasOriginalSource = samples.some((item) => {
            const sourceUrl = asText(item?.source_url)?.toLowerCase() ?? "";
            return sourceUrl.length > 0 && !sourceUrl.includes("/optimized/");
          });

          if (hasOriginalSource) {
            return reportPath;
          }
        }
      } catch {
        // Continue scanning next candidate.
      }
    }

    if (fallbackApplyWithSamples) return fallbackApplyWithSamples;
    return candidates[0] ?? null;
  }

  return path.isAbsolute(input) ? input : path.join(ROOT, input);
};

const listAllOptimizeReportPaths = () =>
  fs
    .readdirSync(DEFAULT_REPORTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^media-optimize-.*\.json$/i.test(entry.name))
    .map((entry) => path.join(DEFAULT_REPORTS_DIR, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

const readReportSummary = (reportPath) => {
  try {
    const parsed = readJsonFile(reportPath);
    const mode = asText(parsed?.summary?.mode)?.toLowerCase();
    const samples = Array.isArray(parsed?.optimized_samples) ? parsed.optimized_samples : [];
    const hasSamples = samples.length > 0;
    return { parsed, mode, samples, hasSamples };
  } catch {
    return null;
  }
};

const collectRemapReportPaths = (sourceMapRawValue, resolvedPath) => {
  if (!sourceMapRawValue) {
    return [];
  }

  const rawText = asText(sourceMapRawValue)?.toLowerCase() ?? "";
  if (rawText !== "latest") {
    return resolvedPath ? [resolvedPath] : [];
  }

  const all = listAllOptimizeReportPaths();
  const applyWithSamples = all.filter((reportPath) => {
    const summary = readReportSummary(reportPath);
    return Boolean(summary?.mode === "apply" && summary?.hasSamples);
  });
  if (applyWithSamples.length) {
    return applyWithSamples;
  }

  return resolvedPath ? [resolvedPath] : [];
};

const buildRemapFromReports = (reportPaths) => {
  const directMap = new Map();

  reportPaths.forEach((reportPath) => {
    if (!fs.existsSync(reportPath)) return;
    const summary = readReportSummary(reportPath);
    if (!summary?.hasSamples) return;

    summary.samples.forEach((sample) => {
      if (!sample || typeof sample !== "object" || Array.isArray(sample)) return;
      const sourceUrl = asText(sample.source_url);
      const newUrl = asText(sample.new_url);
      if (sourceUrl && newUrl) directMap.set(newUrl, sourceUrl);

      const uploaded = Array.isArray(sample.uploaded) ? sample.uploaded : [];
      uploaded.forEach((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
        const uploadedUrl = asText(entry.public_url);
        if (sourceUrl && uploadedUrl) directMap.set(uploadedUrl, sourceUrl);
      });
    });
  });

  const resolveRootSource = (startUrl) => {
    const seen = new Set();
    let current = startUrl;
    while (directMap.has(current) && !seen.has(current)) {
      seen.add(current);
      current = directMap.get(current);
    }
    return current;
  };

  const resolvedMap = new Map();
  for (const key of directMap.keys()) {
    resolvedMap.set(key, resolveRootSource(key));
  }
  return resolvedMap;
};

const run = async () => {
  if (hasFlag("help")) {
    console.log(HELP_TEXT);
    return;
  }

  const applyFlag = hasFlag("apply");
  const dryRunFlag = hasFlag("dry-run");
  if (applyFlag && dryRunFlag) {
    throw new Error("invalid_flags:use_apply_or_dry_run_not_both");
  }

  const explicitJobArg = readArg("job-file") ?? readArg("job");
  const jobFilePath = resolveJobFilePath(explicitJobArg);
  let job = {};

  if (jobFilePath) {
    if (!fs.existsSync(jobFilePath)) {
      if (explicitJobArg) {
        throw new Error(`job_file_not_found:${jobFilePath}`);
      }
    } else {
      job = readJsonFile(jobFilePath);
    }
  }

  const variants =
    parseVariantsArg(readArg("variants")) ??
    normalizeVariants(job.variants) ??
    DEFAULT_VARIANTS;

  const pathStrategy =
    resolvePathStrategy(readArg("path-strategy")) ??
    resolvePathStrategy(job.path_strategy) ??
    DEFAULT_PATH_STRATEGY;

  const variantPlacement =
    resolveVariantPlacement(readArg("variant-placement")) ??
    resolveVariantPlacement(job.variant_placement) ??
    DEFAULT_VARIANT_PLACEMENT;

  const primaryVariant =
    sanitizePathSegment(readArg("primary-variant")) ||
    sanitizePathSegment(job.primary_variant) ||
    DEFAULT_PRIMARY_VARIANT;

  if (!variants.find((entry) => entry.name === primaryVariant)) {
    throw new Error(`primary_variant_not_found:${primaryVariant}`);
  }

  const apply = applyFlag || (!dryRunFlag && asBoolean(job.apply, false));
  const dryRun = !apply;
  const overwrite = hasFlag("overwrite") || asBoolean(job.overwrite, false);

  const organizationId =
    asText(readArg("organization-id")) ??
    asText(job.organization_id) ??
    asEnv("CRM_ORGANIZATION_ID");
  if (!organizationId || !UUID_RE.test(organizationId)) {
    throw new Error("organization_id_required_uuid (--organization-id or job.organization_id)");
  }

  const bucket =
    asText(readArg("bucket")) ??
    asText(job.bucket) ??
    asEnv("CRM_PROPERTIES_MEDIA_BUCKET") ??
    asEnv("PUBLIC_CRM_PROPERTIES_MEDIA_BUCKET") ??
    DEFAULT_MEDIA_BUCKET;

  const targetBucket =
    asText(readArg("target-bucket")) ??
    asText(job.target_bucket) ??
    bucket;

  const targetPrefix = normalizePrefix(
    asText(readArg("target-prefix")) ??
      asText(job.target_prefix) ??
      asEnv("CRM_MEDIA_OPTIMIZER_TARGET_PREFIX") ??
      DEFAULT_TARGET_PREFIX
  );
  if (!targetPrefix) {
    throw new Error("target_prefix_required");
  }

  const propertyIds =
    splitList(readArg("property-ids") ?? "").length > 0
      ? splitList(readArg("property-ids"))
      : Array.isArray(job.property_ids)
        ? job.property_ids.map((item) => asText(item)).filter((item) => Boolean(item))
        : [];
  const legacyCodes =
    splitList(readArg("legacy-codes") ?? "").length > 0
      ? splitList(readArg("legacy-codes"))
      : Array.isArray(job.legacy_codes)
        ? job.legacy_codes.map((item) => asText(item)).filter((item) => Boolean(item))
        : [];
  const limit = asPositiveInteger(readArg("limit") ?? job.limit);

  const reportPath = buildReportPath(readArg("report-file") ?? job.report_file);
  const maxSourceBytes = asPositiveInteger(readArg("max-source-bytes") ?? job.max_source_bytes);
  const sourceMapRawValue = readArg("source-map-report") ?? job.source_map_report;
  const sourceMapReportPath = resolveSourceMapReportPath(sourceMapRawValue);
  if (sourceMapReportPath && !fs.existsSync(sourceMapReportPath)) {
    throw new Error(`source_map_report_not_found:${sourceMapReportPath}`);
  }
  const sourceMapReportPaths = collectRemapReportPaths(sourceMapRawValue, sourceMapReportPath);
  const sourceUrlRemap = buildRemapFromReports(sourceMapReportPaths);

  const supabaseUrl = asEnv("SUPABASE_URL") ?? asEnv("PUBLIC_SUPABASE_URL");
  const serviceRoleKey = asEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("missing_supabase_credentials (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
  }

  const expectedHost = new URL(supabaseUrl).host;
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { rows, unmatchedLegacyCodes, usedLegacyFallback } = await fetchProperties(client, {
    organizationId,
    propertyIds,
    legacyCodes,
    limit,
  });

  const summary = {
    mode: dryRun ? "dry-run" : "apply",
    organizationId,
    bucket,
    targetBucket,
    targetPrefix,
    path_strategy: pathStrategy,
    variant_placement: variantPlacement,
    variants,
    primaryVariant,
    overwrite,
    source_map_report: sourceMapReportPath ?? null,
    source_map_reports_used: sourceMapReportPaths.length,
    source_map_entries: sourceUrlRemap.size,
    filter: {
      property_ids: propertyIds,
      legacy_codes: legacyCodes,
      legacy_codes_unmatched: unmatchedLegacyCodes,
      legacy_match_mode: usedLegacyFallback ? "case_insensitive_fallback" : "exact",
      limit: limit ?? null,
    },
    properties_scanned: rows.length,
    media_entries_scanned: 0,
    unique_urls_seen: 0,
    unique_urls_eligible: 0,
    unique_urls_optimized: 0,
    reused_from_cache: 0,
    skipped_non_supabase: 0,
    skipped_bucket_mismatch: 0,
    skipped_non_image: 0,
    skipped_already_optimized: 0,
    skipped_too_large: 0,
    db_rows_updated: 0,
    db_rows_unchanged: 0,
    errors: [],
  };

  if (unmatchedLegacyCodes.length > 0) {
    summary.errors.push({
      type: "legacy_code_not_found",
      legacy_codes: unmatchedLegacyCodes,
    });
  }

  const uniqueUrlSeen = new Set();
  const uniqueEligibleKeys = new Set();
  const cache = new Map();
  const propertyChanges = [];

  for (const row of rows) {
    const propertyId = asText(row.id);
    const legacyCode = asText(row.legacy_code) ?? "(sin_legacy_code)";
    if (!propertyId) {
      summary.errors.push({
        property: legacyCode,
        error: "missing_property_id",
      });
      continue;
    }

    const media = deepClone(row.media);
    if (!media || typeof media !== "object" || Array.isArray(media)) {
      summary.db_rows_unchanged += 1;
      continue;
    }
    if (!media.gallery || typeof media.gallery !== "object" || Array.isArray(media.gallery)) {
      media.gallery = {};
    }

    const pointers = extractMediaPointers(media);
    if (!pointers.length) {
      summary.db_rows_unchanged += 1;
      continue;
    }

    let changed = false;
    for (const pointer of pointers) {
      summary.media_entries_scanned += 1;
      const pointerUrl = pointer.sourceUrl;
      const sourceUrl = sourceUrlRemap.get(pointerUrl) ?? pointerUrl;
      uniqueUrlSeen.add(pointerUrl);

      const cached = cache.get(sourceUrl);
      if (cached) {
        summary.reused_from_cache += 1;
        if (cached.newUrl && cached.newUrl !== pointerUrl) {
          pointer.apply(cached.newUrl);
          changed = true;
        }
        continue;
      }

      const parsed = extractStorageObjectFromPublicUrl(sourceUrl, expectedHost);
      if (!parsed) {
        summary.skipped_non_supabase += 1;
        cache.set(sourceUrl, { newUrl: null, reason: "non_supabase" });
        continue;
      }

      if (parsed.bucket !== bucket) {
        summary.skipped_bucket_mismatch += 1;
        cache.set(sourceUrl, { newUrl: null, reason: "bucket_mismatch" });
        continue;
      }

      if (!isSupportedImagePath(parsed.path)) {
        summary.skipped_non_image += 1;
        cache.set(sourceUrl, { newUrl: null, reason: "non_image" });
        continue;
      }

      // Prevent recursive re-optimization chains when URL is already optimized
      // and there is no known map back to an original source URL.
      if (
        pathStrategy === "project_scoped" &&
        isOptimizedTargetPath(parsed.path, targetPrefix, pathStrategy) &&
        !sourceUrlRemap.has(pointerUrl)
      ) {
        summary.skipped_already_optimized += 1;
        cache.set(sourceUrl, { newUrl: null, reason: "optimized_without_source_map" });
        continue;
      }

      if (!overwrite && isOptimizedTargetPath(parsed.path, targetPrefix, pathStrategy)) {
        summary.skipped_already_optimized += 1;
        cache.set(sourceUrl, { newUrl: null, reason: "already_optimized" });
        continue;
      }

      const sourceKey = `${parsed.bucket}/${decodeStoragePath(parsed.path)}`;
      uniqueEligibleKeys.add(sourceKey);

      if (dryRun) {
        cache.set(sourceUrl, { newUrl: null, reason: "dry_run_candidate" });
        continue;
      }

      try {
        const downloaded = await downloadStorageObject(client, parsed.bucket, parsed.path);
        const sourceBuffer = Buffer.from(await downloaded.blob.arrayBuffer());
        if (maxSourceBytes && sourceBuffer.length > maxSourceBytes) {
          summary.skipped_too_large += 1;
          cache.set(sourceUrl, { newUrl: null, reason: "too_large" });
          continue;
        }

        const optimized = await optimizeImageBuffer(sourceBuffer, variants);
        const uploaded = [];

        for (const variantOutput of optimized.outputs) {
          const targetPath = buildTargetPath(
            {
              pathStrategy,
              targetPrefix,
              sourceBucket: parsed.bucket,
              sourceObjectPath: downloaded.objectPath,
              variantName: variantOutput.name,
              variantPlacement,
            }
          );
          const publicUrl = await uploadOptimizedVariant(client, {
            targetBucket,
            targetPath,
            buffer: variantOutput.buffer,
          });
          uploaded.push({
            name: variantOutput.name,
            path: targetPath,
            public_url: publicUrl,
            width: variantOutput.width,
            quality: variantOutput.quality,
            bytes: variantOutput.bytes,
          });
        }

        const primary = uploaded.find((item) => item.name === primaryVariant) ?? uploaded[0];
        const newUrl = primary?.public_url ?? null;
        cache.set(sourceUrl, {
          newUrl,
          uploaded,
          metadata: optimized.metadata,
        });

        if (newUrl && newUrl !== sourceUrl) {
          pointer.apply(newUrl);
          changed = true;
          summary.unique_urls_optimized += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        summary.errors.push({
          property_id: propertyId,
          legacy_code: legacyCode,
          media_location: pointer.location,
          source_url: sourceUrl,
          error: message,
        });
        cache.set(sourceUrl, { newUrl: null, reason: "error", error: message });
      }
    }

    if (!changed) {
      summary.db_rows_unchanged += 1;
      continue;
    }

    propertyChanges.push({
      id: propertyId,
      organization_id: organizationId,
      legacy_code: legacyCode,
      media,
    });
  }

  summary.unique_urls_seen = uniqueUrlSeen.size;
  summary.unique_urls_eligible = uniqueEligibleKeys.size;

  if (!dryRun && propertyChanges.length) {
    for (const change of propertyChanges) {
      const { error } = await client
        .schema("crm")
        .from("properties")
        .update({ media: change.media })
        .eq("id", change.id)
        .eq("organization_id", change.organization_id);

      if (error) {
        summary.errors.push({
          property_id: change.id,
          legacy_code: change.legacy_code,
          error: `db_update_failed:${formatSupabaseError(error)}`,
        });
        continue;
      }

      summary.db_rows_updated += 1;
    }
  }

  const optimizedEntries = Array.from(cache.entries())
    .filter(([, value]) => Array.isArray(value.uploaded))
    .slice(0, 250)
    .map(([sourceUrl, value]) => ({
      source_url: sourceUrl,
      new_url: value.newUrl ?? null,
      uploaded: value.uploaded ?? [],
      metadata: value.metadata ?? null,
    }));

  const report = {
    generated_at: new Date().toISOString(),
    summary,
    optimized_samples: optimizedEntries,
    changed_properties: propertyChanges.slice(0, 250).map((entry) => ({
      id: entry.id,
      legacy_code: entry.legacy_code,
    })),
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Reporte guardado en: ${reportPath}`);
};

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`media_optimize_failed: ${message}`);
  process.exit(1);
});
