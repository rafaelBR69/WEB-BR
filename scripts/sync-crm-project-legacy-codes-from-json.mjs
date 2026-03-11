import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const DEFAULT_SOURCE_DIR = path.join(ROOT, "src", "data", "properties");
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

const asEnv = (key) => {
  const value = process.env[key] ?? envFromFiles[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
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

const normalizeOptionalUuid = (value) => {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.startsWith("<") && text.endsWith(">")) return null;
  if (text.toLowerCase() === "null" || text.toLowerCase() === "none") return null;
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
  return tx === "rent" || tx === "both" || tx === "sale" ? tx : "sale";
};

const toListingType = (raw, recordType, operationType) => {
  const listingType = asText(raw.listing_type)?.toLowerCase();
  if (listingType === "promotion" || listingType === "unit" || listingType === "resale" || listingType === "rental") {
    return listingType;
  }
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
  if (
    status === "draft" ||
    status === "available" ||
    status === "reserved" ||
    status === "sold" ||
    status === "rented" ||
    status === "private" ||
    status === "archived"
  ) {
    return status;
  }
  return "draft";
};

const toPriceFields = (raw, operationType) => {
  const directPrice = asNumber(raw.price);
  const pricingFrom = asNumber(raw?.pricing?.from);
  const price = directPrice ?? pricingFrom;
  if (price == null) return { price_sale: null, price_rent_monthly: null };
  if (operationType === "rent") return { price_sale: null, price_rent_monthly: price };
  return { price_sale: price, price_rent_monthly: null };
};

const normalizeMedia = (rawMedia) => {
  const media = asObject(rawMedia);
  const gallery = asObject(media.gallery);
  return {
    main: media.main ?? null,
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

const normalizeJsonForCrm = ({ raw, organizationId, websiteId, parentPropertyId }) => {
  const legacyCode = asText(raw.id);
  if (!legacyCode) throw new Error("invalid_record_missing_id");

  const recordType = toRecordType(raw);
  const operationType = toOperationType(raw);
  const listingType = toListingType(raw, recordType, operationType);
  const projectBusinessType = toBusinessType(raw, recordType);
  const status = toStatus(raw);
  const { price_sale, price_rent_monthly } = toPriceFields(raw, operationType);

  return {
    organization_id: organizationId,
    website_id: websiteId,
    legacy_code: legacyCode,
    record_type: recordType,
    project_business_type: projectBusinessType,
    commercialization_notes: null,
    parent_property_id: parentPropertyId,
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

const getPrimaryFloorplanUrl = (rawMedia) => {
  const floorplans = asObject(rawMedia).gallery?.floorplan;
  if (!Array.isArray(floorplans)) return null;
  const first = floorplans.find(
    (entry) => typeof entry?.url === "string" && entry.url.toLowerCase().endsWith(".pdf")
  );
  return typeof first?.url === "string" ? first.url.trim() : null;
};

const chunk = (items, size) => {
  const output = [];
  for (let i = 0; i < items.length; i += size) output.push(items.slice(i, i + size));
  return output;
};

const updateRowsById = async (client, rows, chunkSize = 50) => {
  for (const pack of chunk(rows, chunkSize)) {
    await Promise.all(
      pack.map(async ({ id, ...payload }) => {
        const { error } = await client
          .schema("crm")
          .from("properties")
          .update(payload)
          .eq("id", id);
        if (error) {
          throw new Error(`update_failed:${payload.legacy_code}:${String(error.message ?? error)}`);
        }
      })
    );
  }
};

const run = async () => {
  const projectCode = readArg("project-code");
  const organizationId =
    readArg("organization-id") ?? asEnv("CRM_ORGANIZATION_ID") ?? null;
  const rawWebsiteId = readArg("website-id") ?? asEnv("CRM_WEBSITE_ID") ?? null;
  const websiteId = normalizeOptionalUuid(rawWebsiteId);
  const sourceDir =
    readArg("source-dir") ?? asEnv("CRM_PROPERTIES_SOURCE_DIR") ?? DEFAULT_SOURCE_DIR;
  const dryRun = hasFlag("dry-run");

  if (!projectCode) throw new Error("project_code_required (--project-code)");
  if (!organizationId || !UUID_RE.test(organizationId)) {
    throw new Error("organization_id_required_uuid (--organization-id or CRM_ORGANIZATION_ID)");
  }
  if (websiteId && !UUID_RE.test(websiteId)) {
    throw new Error("website_id_must_be_uuid_when_present");
  }
  if (!fs.existsSync(sourceDir)) throw new Error(`source_dir_not_found:${sourceDir}`);

  const supabaseUrl = asEnv("SUPABASE_URL") ?? asEnv("PUBLIC_SUPABASE_URL");
  const serviceRoleKey = asEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("missing_supabase_credentials (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const localEntries = loadRawProperties(sourceDir);
  const localParent = localEntries.find((entry) => String(entry.raw?.id ?? "") === projectCode)?.raw ?? null;
  if (!localParent) throw new Error(`local_parent_not_found:${projectCode}`);

  const localUnits = localEntries
    .map((entry) => entry.raw)
    .filter((raw) => String(raw?.parent_id ?? "") === projectCode);
  if (!localUnits.length) throw new Error(`local_units_not_found:${projectCode}`);

  const { data: parentRow, error: parentError } = await client
    .schema("crm")
    .from("properties")
    .select("id, website_id, legacy_code")
    .eq("organization_id", organizationId)
    .eq("legacy_code", projectCode)
    .maybeSingle();
  if (parentError) throw parentError;
  if (!parentRow?.id) throw new Error(`crm_parent_not_found:${projectCode}`);

  const { data: childRows, error: childError } = await client
    .schema("crm")
    .from("properties")
    .select("id, website_id, legacy_code, parent_property_id, media")
    .eq("organization_id", organizationId)
    .eq("parent_property_id", parentRow.id)
    .order("legacy_code", { ascending: true });
  if (childError) throw childError;

  const crmUnits = childRows ?? [];
  if (crmUnits.length !== localUnits.length) {
    throw new Error(
      `unit_count_mismatch: crm=${crmUnits.length} local=${localUnits.length} project=${projectCode}`
    );
  }

  const localByLegacy = new Map(localUnits.map((raw) => [String(raw.id), raw]));
  const localByFloorplan = new Map(
    localUnits
      .map((raw) => [getPrimaryFloorplanUrl(raw.media), raw])
      .filter(([floorplan]) => Boolean(floorplan))
  );

  const matchedLocalIds = new Set();
  const childUpdates = crmUnits.map((row) => {
    const crmFloorplan = getPrimaryFloorplanUrl(row.media);
    const localRaw =
      localByLegacy.get(String(row.legacy_code)) ??
      (crmFloorplan ? localByFloorplan.get(crmFloorplan) : null);

    if (!localRaw) {
      throw new Error(`local_match_not_found_for_crm_unit:${row.legacy_code}`);
    }

    matchedLocalIds.add(String(localRaw.id));

    return {
      id: row.id,
      ...normalizeJsonForCrm({
        raw: localRaw,
        organizationId,
        websiteId: websiteId ?? row.website_id ?? null,
        parentPropertyId: parentRow.id,
      }),
    };
  });

  const unmatchedLocal = localUnits
    .map((raw) => String(raw.id))
    .filter((legacyCode) => !matchedLocalIds.has(legacyCode));
  if (unmatchedLocal.length) {
    throw new Error(`unmatched_local_units:${unmatchedLocal.join(",")}`);
  }

  const parentUpdate = {
    id: parentRow.id,
    ...normalizeJsonForCrm({
      raw: localParent,
      organizationId,
      websiteId: websiteId ?? parentRow.website_id ?? null,
      parentPropertyId: null,
    }),
  };

  const summary = {
    projectCode,
    sourceDir,
    dryRun,
    organizationId,
    parent: {
      id: parentRow.id,
      legacy_code_from: parentRow.legacy_code,
      legacy_code_to: parentUpdate.legacy_code,
    },
    units: childUpdates.map((row) => ({
      id: row.id,
      legacy_code_to: row.legacy_code,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));
  if (dryRun) {
    console.log("Dry run completado. No se escribieron cambios.");
    return;
  }

  await updateRowsById(client, [parentUpdate, ...childUpdates]);
  console.log(`Sincronizacion completada para ${projectCode}. Filas actualizadas: ${1 + childUpdates.length}`);
};

run().catch((error) => {
  console.error("Error en sincronizacion CRM:", error.message);
  process.exit(1);
});
