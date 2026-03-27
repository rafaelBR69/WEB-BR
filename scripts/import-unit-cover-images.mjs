import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import {
  ROOT,
  DEFAULT_BUCKET,
  DEFAULT_MAX_DIMENSION,
  DEFAULT_ROOT_DIR,
  asText,
  createUnitCoverPlan,
  hasFlag,
  normalizeCode,
  readArg,
  splitList,
} from "./lib/unit-cover-mapping.mjs";

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

const asEnv = (key) => asText(process.env[key] ?? envFromFiles[key] ?? null);

const optimizeCoverBuffer = async (absolutePath) => {
  const image = sharp(absolutePath).rotate();
  const metadata = await image.metadata();
  const resized = image.resize({
    width: DEFAULT_MAX_DIMENSION,
    height: DEFAULT_MAX_DIMENSION,
    fit: "inside",
    withoutEnlargement: true,
  });

  const useLossless = metadata.format === "png";
  const buffer = useLossless
    ? await resized.webp({ lossless: true, effort: 6 }).toBuffer()
    : await resized.webp({ quality: 84, effort: 6, smartSubsample: true }).toBuffer();

  return {
    buffer,
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    sourceFormat: metadata.format ?? null,
    lossless: useLossless,
  };
};

const buildPublicUrl = (supabaseUrl, bucket, objectPath) => {
  const base = String(supabaseUrl).replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${bucket}/${objectPath}`;
};

const updateUnitJsonCover = (child, publicUrl) => {
  const next = JSON.parse(JSON.stringify(child.data));
  const currentCover =
    next.media && typeof next.media.cover === "object" && next.media.cover !== null
      ? next.media.cover
      : {};
  const title =
    asText(next?.translations?.es?.title) ??
    asText(next?.seo?.es?.title) ??
    asText(next?.translations?.en?.title) ??
    child.id;

  if (!next.media || typeof next.media !== "object" || Array.isArray(next.media)) {
    next.media = { cover: null, gallery: {} };
  }

  next.media.cover = {
    ...currentCover,
    url: publicUrl,
    alt:
      currentCover.alt && typeof currentCover.alt === "object" && !Array.isArray(currentCover.alt)
        ? currentCover.alt
        : { es: title },
  };

  return next;
};

const syncCrmMedia = (codes) => {
  const scriptPath = path.join(ROOT, "scripts", "sync-public-property-copy-to-crm.mjs");
  const result = spawnSync(process.execPath, [scriptPath, `--codes=${codes.join(",")}`], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`sync_public_property_copy_failed:${result.status ?? "unknown"}`);
  }
};

const buildRequestedProjects = () =>
  new Set(splitList(readArg("project") ?? readArg("projects")).map((value) => normalizeCode(value)));

const buildBaseOutput = (plan, dryRun) => ({
  dryRun,
  rootDir: plan.report.rootDir,
  projectFilter: plan.report.projectFilter,
  summary: plan.report.summary,
  matched: plan.report.matched,
  unresolved: plan.report.unresolved,
  duplicates: plan.report.duplicates,
  projects: plan.report.projects,
});

const run = async () => {
  const rootDir = path.resolve(readArg("root-dir") ?? DEFAULT_ROOT_DIR);
  const requestedProjects = buildRequestedProjects();
  const dryRun = hasFlag("dry-run") || !hasFlag("apply");
  const syncCrm = hasFlag("sync-crm");
  const overwrite = hasFlag("overwrite");
  const bucket =
    asText(
      readArg("bucket") ??
        asEnv("CRM_PROPERTIES_MEDIA_BUCKET") ??
        asEnv("PUBLIC_CRM_PROPERTIES_MEDIA_BUCKET")
    ) ?? DEFAULT_BUCKET;

  const plan = createUnitCoverPlan({ rootDir, requestedProjects });
  const output = buildBaseOutput(plan, dryRun);

  if (dryRun) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (plan.report.duplicates.length) {
    console.log(JSON.stringify(output, null, 2));
    throw new Error(
      `duplicate_unit_cover_matches:${plan.report.duplicates
        .map((item) => `${item.projectCode}:${item.childCode}`)
        .join(",")}`
    );
  }

  const supabaseUrl = asEnv("SUPABASE_URL") ?? asEnv("PUBLIC_SUPABASE_URL");
  const serviceRoleKey = asEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("missing_supabase_credentials (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const updatedCodes = [];

  for (const item of plan.importItems) {
    const optimized = await optimizeCoverBuffer(item.sourceAbsolutePath);
    const { error } = await client.storage.from(bucket).upload(item.objectPath, optimized.buffer, {
      upsert: overwrite,
      contentType: "image/webp",
      cacheControl: "3600",
    });

    if (error) {
      if (!overwrite && String(error.message).toLowerCase().includes("already exists")) {
        // Keep the JSON pointed at the deterministic destination even if the file already exists.
      } else {
        throw new Error(`storage_upload_failed:${item.child.id}:${error.message}`);
      }
    }

    const publicUrl = buildPublicUrl(supabaseUrl, bucket, item.objectPath);
    const nextJson = updateUnitJsonCover(item.child, publicUrl);
    fs.writeFileSync(item.child.filePath, `${JSON.stringify(nextJson, null, 2)}\n`, "utf8");
    updatedCodes.push(item.child.id);
  }

  if (syncCrm && updatedCodes.length) {
    syncCrmMedia(updatedCodes);
  }

  console.log(
    JSON.stringify(
      {
        ...output,
        updatedCodes,
        syncedCrm: syncCrm && updatedCodes.length > 0,
      },
      null,
      2
    )
  );
};

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`import_unit_cover_images_failed: ${message}`);
  process.exit(1);
});
