import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const DEFAULT_SOURCE_DIR = path.join(ROOT, "src", "data", "properties");
const STATUS_VALUES = new Set([
  "draft",
  "available",
  "reserved",
  "sold",
  "rented",
  "private",
  "archived",
]);
const RECORD_TYPES = new Set(["project", "unit", "single"]);
const OPERATION_TYPES = new Set(["sale", "rent", "both"]);
const LISTING_TYPES = new Set(["promotion", "unit", "resale", "rental"]);
const BUSINESS_TYPES = new Set([
  "owned_and_commercialized",
  "provider_and_commercialized_by_us",
  "external_listing",
]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    if (hashIndex >= 0) {
      value = value.slice(0, hashIndex).trim();
    }

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

const asNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const asObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};

const hasFlag = (flagName) => process.argv.includes(`--${flagName}`);

const readArg = (flagName) => {
  const prefix = `--${flagName}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const flagIndex = process.argv.indexOf(`--${flagName}`);
  if (flagIndex >= 0) return process.argv[flagIndex + 1] || null;
  return null;
};

const asEnv = (key) => {
  const value = process.env[key] ?? envFromFiles[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const normalizeOptionalUuid = (value) => {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;

  // Common placeholders used in .env templates.
  if (text.startsWith("<") && text.endsWith(">")) return null;
  if (text.toLowerCase() === "null") return null;
  if (text.toLowerCase() === "none") return null;

  return text;
};

const toRecordType = (raw) => {
  const listingType = asText(raw.listing_type);
  const hasParent = Boolean(asText(raw.parent_id));
  if (listingType === "promotion") return "project";
  if (listingType === "unit" || hasParent) return "unit";
  return "single";
};

const toOperationType = (raw) => {
  const tx = asText(raw.transaction)?.toLowerCase();
  if (tx && OPERATION_TYPES.has(tx)) return tx;
  return "sale";
};

const toListingType = (raw, recordType, operationType) => {
  const listingType = asText(raw.listing_type)?.toLowerCase();
  if (listingType && LISTING_TYPES.has(listingType)) return listingType;
  if (recordType === "project") return "promotion";
  if (recordType === "unit") return "unit";
  if (operationType === "rent") return "rental";
  return "resale";
};

const toBusinessType = (raw, recordType) => {
  if (raw.is_own_project === true) return "owned_and_commercialized";
  const market = asText(raw?.property?.market)?.toLowerCase();
  if (market === "obra_nueva" || recordType === "project" || recordType === "unit") {
    return "provider_and_commercialized_by_us";
  }
  return "external_listing";
};

const toStatus = (raw) => {
  const status = asText(raw.status)?.toLowerCase();
  if (status && STATUS_VALUES.has(status)) return status;
  return "draft";
};

const toPriceFields = (raw, operationType) => {
  const directPrice = asNumber(raw.price);
  const pricingFrom = asNumber(raw?.pricing?.from);
  const price = directPrice ?? pricingFrom;
  if (price == null) {
    return { price_sale: null, price_rent_monthly: null };
  }
  if (operationType === "rent") {
    return { price_sale: null, price_rent_monthly: price };
  }
  if (operationType === "both") {
    return { price_sale: price, price_rent_monthly: null };
  }
  return { price_sale: price, price_rent_monthly: null };
};

const normalizeMedia = (rawMedia) => {
  const media = asObject(rawMedia);
  const gallery = asObject(media.gallery);
  return {
    cover: media.cover ?? null,
    gallery: {
      living: Array.isArray(gallery.living) ? gallery.living : [],
      bedroom: Array.isArray(gallery.bedroom) ? gallery.bedroom : [],
      kitchen: Array.isArray(gallery.kitchen) ? gallery.kitchen : [],
      bathroom: Array.isArray(gallery.bathroom) ? gallery.bathroom : [],
      exterior: Array.isArray(gallery.exterior) ? gallery.exterior : [],
      interior: Array.isArray(gallery.interior) ? gallery.interior : [],
      views: Array.isArray(gallery.views) ? gallery.views : [],
      floorplan: Array.isArray(gallery.floorplan) ? gallery.floorplan : [],
    },
  };
};

const toPropertyData = (raw) => {
  const property = asObject(raw.property);
  return {
    ...property,
    priority: asNumber(raw.priority),
    phase: asText(raw.phase),
    rent_price_on_request: false,
  };
};

const loadRawProperties = (sourceDir) => {
  const entries = fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));

  return entries.map((fileName) => {
    const absPath = path.join(sourceDir, fileName);
    const raw = JSON.parse(fs.readFileSync(absPath, "utf8"));
    return { fileName, raw };
  });
};

const normalizeForCrm = ({ raw, organizationId, websiteId }) => {
  const legacyCode = asText(raw.id);
  if (!legacyCode) {
    throw new Error("invalid_record_missing_id");
  }

  const recordType = toRecordType(raw);
  if (!RECORD_TYPES.has(recordType)) {
    throw new Error(`invalid_record_type:${recordType}`);
  }

  const operationType = toOperationType(raw);
  const listingType = toListingType(raw, recordType, operationType);
  const projectBusinessType = toBusinessType(raw, recordType);
  const status = toStatus(raw);
  const { price_sale, price_rent_monthly } = toPriceFields(raw, operationType);

  if (!BUSINESS_TYPES.has(projectBusinessType)) {
    throw new Error(`invalid_business_type:${projectBusinessType}`);
  }

  return {
    legacyCode,
    parentLegacyCode: asText(raw.parent_id),
    row: {
      organization_id: organizationId,
      website_id: websiteId,
      legacy_code: legacyCode,
      record_type: recordType,
      project_business_type: projectBusinessType,
      commercialization_notes: null,
      parent_property_id: null,
      operation_type: operationType,
      listing_type: listingType,
      status,
      is_featured: raw.featured === true,
      is_public: true,
      price_sale,
      price_rent_monthly,
      price_currency: asText(raw.currency) ?? "EUR",
      location: asObject(raw.location),
      property_data: toPropertyData(raw),
      features: Array.isArray(raw.features) ? raw.features.filter((v) => typeof v === "string") : [],
      media: normalizeMedia(raw.media),
      translations: asObject(raw.translations),
      slugs: asObject(raw.slugs),
      seo: asObject(raw.seo),
    },
  };
};

const chunk = (items, size) => {
  const output = [];
  for (let i = 0; i < items.length; i += size) {
    output.push(items.slice(i, i + size));
  }
  return output;
};

const formatSupabaseError = (error) => {
  if (!error) return "unknown_error";
  const message = String(error.message ?? "unknown_error");
  const details = error.details ? `details=${String(error.details)}` : null;
  const hint = error.hint ? `hint=${String(error.hint)}` : null;

  if (message.includes("Invalid schema: crm")) {
    return `${message}. Accion: Supabase Dashboard -> Settings -> API -> Exposed schemas -> agrega 'crm'.`;
  }

  return [message, details, hint].filter(Boolean).join(" | ");
};

const upsertRows = async (client, rows, chunkSize = 100) => {
  const packs = chunk(rows, chunkSize);
  for (const [index, pack] of packs.entries()) {
    const { error } = await client
      .schema("crm")
      .from("properties")
      .upsert(pack, {
        onConflict: "organization_id,legacy_code",
        ignoreDuplicates: false,
      });
    if (error) {
      throw new Error(`upsert_failed_pack_${index + 1}: ${formatSupabaseError(error)}`);
    }
  }
};

const summarize = (records) => {
  const stats = {
    total: records.length,
    project: 0,
    unit: 0,
    single: 0,
    available: 0,
    sold: 0,
    owned_and_commercialized: 0,
    provider_and_commercialized_by_us: 0,
    external_listing: 0,
    with_parent: 0,
  };
  records.forEach(({ row, parentLegacyCode }) => {
    stats[row.record_type] += 1;
    stats[row.project_business_type] += 1;
    if (row.status === "available") stats.available += 1;
    if (row.status === "sold") stats.sold += 1;
    if (parentLegacyCode) stats.with_parent += 1;
  });
  return stats;
};

const run = async () => {
  const organizationId =
    readArg("organization-id") ?? asEnv("CRM_ORGANIZATION_ID") ?? null;
  const rawWebsiteId = readArg("website-id") ?? asEnv("CRM_WEBSITE_ID") ?? null;
  const websiteId = normalizeOptionalUuid(rawWebsiteId);
  const sourceDir =
    readArg("source-dir") ?? asEnv("CRM_PROPERTIES_SOURCE_DIR") ?? DEFAULT_SOURCE_DIR;
  const limitArg = readArg("limit");
  const limit = limitArg ? Number(limitArg) : null;
  const dryRun = hasFlag("dry-run");

  if (!organizationId || !UUID_RE.test(organizationId)) {
    throw new Error("organization_id_required_uuid (--organization-id or CRM_ORGANIZATION_ID)");
  }
  if (websiteId && !UUID_RE.test(websiteId)) {
    console.warn(
      "Aviso: CRM_WEBSITE_ID/--website-id no es UUID valido; se ignorara y se migrara con website_id=null."
    );
  }
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`source_dir_not_found: ${sourceDir}`);
  }
  if (limitArg && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error("limit_must_be_positive_integer");
  }

  const files = loadRawProperties(sourceDir);
  const scoped = limit ? files.slice(0, limit) : files;
  const records = scoped.map((entry) =>
    normalizeForCrm({
      ...entry,
      organizationId,
      websiteId: websiteId && UUID_RE.test(websiteId) ? websiteId : null,
    })
  );
  const stats = summarize(records);

  console.log(
    JSON.stringify(
      {
        sourceDir,
        dryRun,
        organizationId,
        websiteId: websiteId ?? null,
        ...stats,
      },
      null,
      2
    )
  );

  if (dryRun) {
    console.log("Dry run completado. No se escribieron datos en Supabase.");
    return;
  }

  const supabaseUrl = asEnv("SUPABASE_URL") ?? asEnv("PUBLIC_SUPABASE_URL");
  const serviceRoleKey = asEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("missing_supabase_credentials (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  console.log("Upsert base de propiedades...");
  await upsertRows(
    client,
    records.map((record) => record.row)
  );

  const { data: legacyRows, error: mapError } = await client
    .schema("crm")
    .from("properties")
    .select("id, legacy_code")
    .eq("organization_id", organizationId);

  if (mapError) {
    throw new Error(`fetch_legacy_map_failed: ${formatSupabaseError(mapError)}`);
  }

  const legacyMap = new Map(
    (legacyRows ?? [])
      .filter((row) => row?.legacy_code && row?.id)
      .map((row) => [String(row.legacy_code), String(row.id)])
  );

  const unresolvedParents = [];
  const rowsWithParents = records.map(({ row, parentLegacyCode }) => {
    if (!parentLegacyCode) {
      return row;
    }
    const parentId = legacyMap.get(parentLegacyCode);
    if (!parentId) {
      unresolvedParents.push({
        child: row.legacy_code,
        parent_legacy_code: parentLegacyCode,
      });
      return row;
    }
    return {
      ...row,
      parent_property_id: parentId,
    };
  });

  console.log("Upsert de relaciones padre-hijo...");
  await upsertRows(client, rowsWithParents);

  if (unresolvedParents.length) {
    console.warn("Padres no resueltos:");
    console.warn(JSON.stringify(unresolvedParents.slice(0, 25), null, 2));
    if (unresolvedParents.length > 25) {
      console.warn(`... y ${unresolvedParents.length - 25} mas`);
    }
  }

  const { count, error: countError } = await client
    .schema("crm")
    .from("properties")
    .select("*", { head: true, count: "exact" })
    .eq("organization_id", organizationId);

  if (countError) {
    throw new Error(`count_failed: ${formatSupabaseError(countError)}`);
  }

  console.log(`Migracion completada. Propiedades en CRM para la organizacion: ${count ?? 0}`);
};

run().catch((error) => {
  console.error("Error en migracion JSON -> CRM:", error.message);
  process.exit(1);
});
