import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT_DIR = process.cwd();
const PROPERTIES_DIR = path.join(ROOT_DIR, "src", "data", "properties");
const ENV_PATH = path.join(ROOT_DIR, ".env");

const parseArgs = (argv) => {
  const options = {
    dryRun: false,
    codes: [],
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg.startsWith("--codes=")) {
      options.codes = arg
        .slice("--codes=".length)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      continue;
    }
  }

  return options;
};

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key || process.env[key]) continue;
    process.env[key] = value;
  }
};

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};

const stableStringify = (value) => JSON.stringify(value);

const loadPropertyJsonByCode = (code) => {
  const filePath = path.join(PROPERTIES_DIR, `${code}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Property JSON not found for code: ${code}`);
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    code,
    filePath,
    data: parsed,
  };
};

const mergeMedia = (currentMedia, nextMedia) => {
  const current = asRecord(currentMedia);
  const next = asRecord(nextMedia);

  return {
    ...current,
    ...next,
    cover:
      next.cover || current.cover
        ? {
            ...asRecord(current.cover),
            ...asRecord(next.cover),
            alt:
              asRecord(next.cover).alt && Object.keys(asRecord(next.cover).alt).length > 0
                ? asRecord(next.cover).alt
                : asRecord(current.cover).alt,
          }
        : undefined,
    gallery:
      next.gallery || current.gallery
        ? {
            ...asRecord(current.gallery),
            ...asRecord(next.gallery),
          }
        : undefined,
  };
};

const pickPublicPayload = (property, currentMedia) => ({
  translations: asRecord(property.translations),
  slugs: asRecord(property.slugs),
  seo: asRecord(property.seo),
  media: mergeMedia(currentMedia, property.media),
});

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (!options.codes.length) {
    throw new Error("Missing required --codes=CODE1,CODE2");
  }

  loadEnvFile(ENV_PATH);

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const organizationId = process.env.CRM_ORGANIZATION_ID ?? null;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const localProperties = options.codes.map(loadPropertyJsonByCode);
  const wantedCodes = localProperties.map((entry) => entry.code);

  let query = client
    .schema("crm")
    .from("properties")
    .select("id, organization_id, legacy_code, translations, slugs, seo, media")
    .in("legacy_code", wantedCodes);

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = Array.isArray(data) ? data : [];
  const rowByCode = new Map(rows.map((row) => [String(row.legacy_code), row]));

  const missingCodes = wantedCodes.filter((code) => !rowByCode.has(code));
  if (missingCodes.length) {
    throw new Error(`Missing CRM rows for codes: ${missingCodes.join(", ")}`);
  }

  const updates = [];

  for (const property of localProperties) {
    const currentRow = rowByCode.get(property.code);
    const nextPayload = pickPublicPayload(property.data, currentRow.media);
    const currentPayload = {
      translations: asRecord(currentRow.translations),
      slugs: asRecord(currentRow.slugs),
      seo: asRecord(currentRow.seo),
      media: asRecord(currentRow.media),
    };

    const changedFields = [];
    if (stableStringify(currentPayload.translations) !== stableStringify(nextPayload.translations)) {
      changedFields.push("translations");
    }
    if (stableStringify(currentPayload.slugs) !== stableStringify(nextPayload.slugs)) {
      changedFields.push("slugs");
    }
    if (stableStringify(currentPayload.seo) !== stableStringify(nextPayload.seo)) {
      changedFields.push("seo");
    }
    if (stableStringify(currentPayload.media) !== stableStringify(nextPayload.media)) {
      changedFields.push("media");
    }

    if (!changedFields.length) continue;

    updates.push({
      id: String(currentRow.id),
      legacyCode: property.code,
      changedFields,
      payload: nextPayload,
    });
  }

  if (!updates.length) {
    console.log("No CRM updates required.");
    return;
  }

  console.log(`Prepared ${updates.length} CRM update(s).`);
  for (const update of updates) {
    console.log(`- ${update.legacyCode}: ${update.changedFields.join(", ")}`);
  }

  if (options.dryRun) {
    console.log("Dry run complete. No changes were written.");
    return;
  }

  for (const update of updates) {
    const { error: updateError } = await client
      .schema("crm")
      .from("properties")
      .update(update.payload)
      .eq("id", update.id);

    if (updateError) {
      throw new Error(`Failed updating ${update.legacyCode}: ${updateError.message}`);
    }
  }

  console.log("CRM sync completed successfully.");
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
