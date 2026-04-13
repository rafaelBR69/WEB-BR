import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const PM0074_ID = "PM0074";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) return;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) return;
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
};

[
  path.join(repoRoot, ".env"),
  path.join(repoRoot, ".env.local"),
  path.join(repoRoot, ".env.development"),
  path.join(repoRoot, ".env.development.local"),
].forEach(loadEnvFile);

const args = process.argv.slice(2);

const getArgValue = (flag) => {
  const direct = args.find((entry) => entry.startsWith(`${flag}=`));
  if (direct) return direct.slice(flag.length + 1);
  const index = args.indexOf(flag);
  if (index >= 0) return args[index + 1] ?? null;
  return null;
};

const hasFlag = (flag) => args.includes(flag);

const lang = String(getArgValue("--lang") ?? "es").trim().toLowerCase() || "es";
const outputPathValue = getArgValue("--out");
const format = String(getArgValue("--format") ?? "json").trim().toLowerCase() || "json";
const sourceFilter = String(getArgValue("--source") ?? "both").trim().toLowerCase() || "both";

const asRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};

const asText = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const asNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const sortById = (items) =>
  [...items].sort((left, right) =>
    String(left?.id ?? "").localeCompare(String(right?.id ?? ""), undefined, { numeric: true })
  );

const toOperationType = (value) => {
  if (value === "sale" || value === "rent" || value === "both") return value;
  return "sale";
};

const toStatus = (value) => {
  const status = asText(value);
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
  return "available";
};

const toListingType = (row) => {
  const listingType = asText(row.listing_type);
  if (listingType === "promotion" || listingType === "unit" || listingType === "resale" || listingType === "rental") {
    return listingType;
  }
  const recordType = asText(row.record_type);
  const operationType = asText(row.operation_type);
  if (recordType === "project") return "promotion";
  if (recordType === "unit") return "unit";
  if (operationType === "rent") return "rental";
  return "resale";
};

const getFloorplanUrl = (property) => {
  const floorplans = Array.isArray(property?.media?.gallery?.floorplan)
    ? property.media.gallery.floorplan
    : [];
  const item = floorplans.find(
    (entry) => typeof entry?.url === "string" && entry.url.toLowerCase().endsWith(".pdf")
  );
  return item?.url ?? "";
};

const parseUnitFromFloorplan = (url) => {
  const fileName = url.split("/").pop()?.replace(/\.pdf$/i, "") ?? "";
  const [portalRaw, floorRaw, letterRaw] = fileName.split("-");
  const portal = Number(portalRaw);
  const floorToken = String(floorRaw ?? "").trim().toLowerCase();
  const letter = String(letterRaw ?? "").trim().toUpperCase();

  if (!Number.isFinite(portal) || !floorToken || !letter) return null;

  const floorNumber = floorToken === "atico" || floorToken === "atico" ? 5 : Number(floorToken);
  if (!Number.isFinite(floorNumber)) return null;

  const isGroundFloor = floorNumber === 0;
  const isPenthouse = floorNumber === 5;
  const suffix = isGroundFloor ? `B${letter}` : isPenthouse ? `AT${letter}` : `${floorNumber}${letter}`;
  const slugFloor = isGroundFloor ? "bajo" : isPenthouse ? "atico" : `planta-${floorNumber}`;
  const unitCode = `P${portal}-${suffix}`;

  return {
    portal,
    letter,
    slugFloor,
    unitCode,
    id: `${PM0074_ID}-P${portal}_${suffix}`,
  };
};

const unitSlugs = (portal, slugFloor, letter) => ({
  es: `unidad-portal-${portal}-${slugFloor}-${letter.toLowerCase()}-orion-collection-almitak-mijas`,
  en: `unit-portal-${portal}-${slugFloor}-${letter.toLowerCase()}-orion-collection-almitak-mijas`,
  de: `einheit-portal-${portal}-${slugFloor}-${letter.toLowerCase()}-orion-collection-almitak-mijas`,
  fr: `unite-portal-${portal}-${slugFloor}-${letter.toLowerCase()}-orion-collection-almitak-mijas`,
  it: `unita-portal-${portal}-${slugFloor}-${letter.toLowerCase()}-orion-collection-almitak-mijas`,
  nl: `unit-portal-${portal}-${slugFloor}-${letter.toLowerCase()}-orion-collection-almitak-mijas`,
});

const normalizePm0074PublicProperty = (property) => {
  if (!property || typeof property !== "object") return property;

  const id = String(property.id ?? "");
  const parentId = String(property.parent_id ?? "");
  const isParent = id === PM0074_ID && property.listing_type === "promotion";
  const isUnit = property.listing_type === "unit" && (id.startsWith(`${PM0074_ID}-`) || parentId === PM0074_ID);

  if (isParent) {
    return {
      ...property,
      slugs: {
        es: "obra-nueva-almitak-mijas",
        en: "new-build-almitak-mijas",
        de: "neubau-almitak-mijas",
        fr: "programme-neuf-almitak-mijas",
        it: "nuova-costruzione-almitak-mijas",
        nl: "nieuwbouw-almitak-mijas",
      },
    };
  }

  if (!isUnit) return property;

  const parsed = parseUnitFromFloorplan(getFloorplanUrl(property));
  if (!parsed) return property;

  return {
    ...property,
    id: parsed.id,
    slugs: unitSlugs(parsed.portal, parsed.slugFloor, parsed.letter),
    property: {
      ...(property.property ?? {}),
      portal: parsed.portal,
      unit_code: parsed.unitCode,
    },
  };
};

const mapCrmRowToPublicProperty = (row, legacyCodeById) => {
  const id = asText(row.id);
  const legacyCode = asText(row.legacy_code);
  if (!id || !legacyCode) return null;

  const operationType = toOperationType(row.operation_type);
  const salePrice = asNumber(row.price_sale);
  const rentPrice = asNumber(row.price_rent_monthly);
  const listingType = toListingType(row);

  return {
    id: legacyCode,
    crm_id: id,
    legacy_code: legacyCode,
    parent_id: row.parent_property_id ? legacyCodeById.get(String(row.parent_property_id)) ?? null : null,
    listing_type: listingType,
    record_type: asText(row.record_type) ?? "single",
    project_business_type: asText(row.project_business_type),
    status: toStatus(row.status),
    featured: row.is_featured === true,
    is_public: row.is_public !== false,
    transaction: operationType,
    operation_type: operationType,
    price:
      operationType === "rent"
        ? rentPrice
        : operationType === "both"
          ? salePrice ?? rentPrice
          : salePrice,
    pricing: {
      from: listingType === "promotion" ? salePrice : null,
      price_sale: salePrice,
      price_rent_monthly: rentPrice,
    },
    currency: asText(row.price_currency) ?? "EUR",
    location: asRecord(row.location),
    property: asRecord(row.property_data),
    features: Array.isArray(row.features) ? row.features.filter((item) => typeof item === "string") : [],
    media: asRecord(row.media),
    seo: asRecord(row.seo),
    slugs: asRecord(row.slugs),
    translations: asRecord(row.translations),
    website_id: asText(row.website_id),
    priority: asNumber(asRecord(row.property_data).priority) ?? 0,
    created_at: asText(row.created_at),
    updated_at: asText(row.updated_at),
  };
};

const resolveSlug = (property, selectedLang) => {
  const scopedSlug = asText(asRecord(property?.slugs)?.[selectedLang]);
  if (scopedSlug) return scopedSlug;
  return asText(asRecord(property?.slugs)?.es) ?? "";
};

const resolveOwnCoordinates = (property) => {
  const lat = asNumber(property?.location?.coordinates?.lat);
  const lng = asNumber(property?.location?.coordinates?.lng);
  if (lat === null || lng === null) return null;
  return { lat, lng };
};

const resolveInheritedCoordinates = (property, propertyById) => {
  const parentId = asText(property?.parent_id);
  if (!parentId) return null;
  const parentProperty = propertyById.get(parentId);
  return parentProperty ? resolveOwnCoordinates(parentProperty) : null;
};

const evaluatePropertyCoverage = (property, propertyById, selectedLang, sourceLabel) => {
  const ownCoordinates = resolveOwnCoordinates(property);
  const inheritedCoordinates = ownCoordinates ? null : resolveInheritedCoordinates(property, propertyById);
  const slug = resolveSlug(property, selectedLang);
  const status = String(property?.status ?? "").trim() || "available";

  let included = false;
  let reason = "included";
  if (status !== "available") {
    reason = "status_not_available";
  } else if (!slug) {
    reason = "missing_slug";
  } else if (!ownCoordinates && !inheritedCoordinates) {
    reason = "missing_coordinates";
  } else {
    included = true;
  }

  const effectiveCoordinates = ownCoordinates ?? inheritedCoordinates;

  return {
    id: String(property?.id ?? "").trim(),
    parent_id: String(property?.parent_id ?? "").trim(),
    listing_type: String(property?.listing_type ?? "").trim(),
    status,
    slug,
    own_coordinates: Boolean(ownCoordinates),
    inherited_coordinates: Boolean(inheritedCoordinates),
    coordinate_source: ownCoordinates ? "self" : inheritedCoordinates ? "parent" : "none",
    lat: effectiveCoordinates?.lat ?? null,
    lng: effectiveCoordinates?.lng ?? null,
    city: String(property?.location?.city ?? "").trim(),
    area: String(property?.location?.area ?? "").trim(),
    source: sourceLabel,
    included,
    reason,
  };
};

const buildCoverageReport = (properties, selectedLang, sourceLabel) => {
  const sortedProperties = sortById(properties);
  const propertyById = new Map(sortedProperties.map((property) => [String(property?.id ?? ""), property]));
  return sortedProperties.map((property) =>
    evaluatePropertyCoverage(property, propertyById, selectedLang, sourceLabel)
  );
};

const summarizeCoverage = (rows) => {
  return rows.reduce(
    (summary, row) => {
      summary.total += 1;
      if (row.included) {
        summary.included += 1;
      } else {
        summary.excluded += 1;
        summary.byReason[row.reason] = (summary.byReason[row.reason] ?? 0) + 1;
      }
      summary.byListingType[row.listing_type || "unknown"] =
        (summary.byListingType[row.listing_type || "unknown"] ?? 0) + 1;
      return summary;
    },
    {
      total: 0,
      included: 0,
      excluded: 0,
      byReason: {},
      byListingType: {},
    }
  );
};

const compareCoverageReports = (jsonRows, crmRows) => {
  const jsonById = new Map(jsonRows.map((row) => [row.id, row]));
  const crmById = new Map(crmRows.map((row) => [row.id, row]));
  const ids = Array.from(new Set([...jsonById.keys(), ...crmById.keys()])).sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true })
  );

  const mismatches = [];

  ids.forEach((id) => {
    const jsonRow = jsonById.get(id) ?? null;
    const crmRow = crmById.get(id) ?? null;

    if (!jsonRow || !crmRow) {
      mismatches.push({
        id,
        mismatch_type: "missing_in_source",
        json_present: Boolean(jsonRow),
        crm_present: Boolean(crmRow),
      });
      return;
    }

    const changes = [];
    const comparableFields = [
      "listing_type",
      "status",
      "slug",
      "coordinate_source",
      "city",
      "area",
      "included",
      "reason",
    ];

    comparableFields.forEach((field) => {
      if (jsonRow[field] !== crmRow[field]) {
        changes.push({
          field,
          json: jsonRow[field],
          crm: crmRow[field],
        });
      }
    });

    if (jsonRow.lat !== crmRow.lat || jsonRow.lng !== crmRow.lng) {
      changes.push({
        field: "coordinates",
        json: jsonRow.lat === null || jsonRow.lng === null ? null : `${jsonRow.lat},${jsonRow.lng}`,
        crm: crmRow.lat === null || crmRow.lng === null ? null : `${crmRow.lat},${crmRow.lng}`,
      });
    }

    if (changes.length > 0) {
      mismatches.push({
        id,
        mismatch_type: "field_difference",
        changes,
      });
    }
  });

  return mismatches;
};

const toCsvValue = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
};

const toCsv = (rows) => {
  if (!rows.length) return "";
  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set())
  );

  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => toCsvValue(row[header])).join(",")),
  ].join("\n");
};

const getJsonProperties = () => {
  const directory = path.join(repoRoot, "src", "data", "properties");
  const fileNames = fs.readdirSync(directory).filter((entry) => entry.endsWith(".json"));
  return sortById(
    fileNames.map((fileName) => {
      const content = fs.readFileSync(path.join(directory, fileName), "utf8");
      return normalizePm0074PublicProperty(JSON.parse(content));
    })
  );
};

const getOrganizationId = () =>
  asText(process.env.PUBLIC_CRM_ORGANIZATION_ID) ??
  asText(process.env.CRM_ORGANIZATION_ID) ??
  null;

const allowAllOrganizations = () => process.env.PUBLIC_CRM_ALLOW_ALL_ORGS === "true";

const getCrmProperties = async () => {
  const supabaseUrl = asText(process.env.SUPABASE_URL);
  const serviceRoleKey = asText(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      source: "supabase_unavailable",
      properties: [],
      available: false,
    };
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const pageSize = 500;
  const rows = [];
  let from = 0;
  const organizationId = allowAllOrganizations() ? null : getOrganizationId();

  while (true) {
    let query = client
      .schema("crm")
      .from("properties")
      .select(
        [
          "id",
          "organization_id",
          "website_id",
          "legacy_code",
          "record_type",
          "project_business_type",
          "operation_type",
          "listing_type",
          "status",
          "is_featured",
          "is_public",
          "price_sale",
          "price_rent_monthly",
          "price_currency",
          "property_data",
          "location",
          "features",
          "media",
          "translations",
          "slugs",
          "seo",
          "created_at",
          "updated_at",
          "parent_property_id",
        ].join(", ")
      )
      .eq("is_public", true)
      .order("updated_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (organizationId) {
      query = query.eq("organization_id", organizationId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Supabase query failed: ${error.message}`);
    }

    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  const legacyCodeById = new Map();
  rows.forEach((row) => {
    const crmId = asText(row.id);
    const legacyCode = asText(row.legacy_code);
    if (crmId && legacyCode) {
      legacyCodeById.set(crmId, legacyCode);
    }
  });

  const properties = sortById(
    rows
      .map((row) => mapCrmRowToPublicProperty(row, legacyCodeById))
      .filter(Boolean)
      .map((property) => normalizePm0074PublicProperty(property))
  );

  return {
    source: "supabase_crm_properties",
    properties,
    available: true,
  };
};

const buildOutput = async () => {
  const includeJson = sourceFilter === "both" || sourceFilter === "json";
  const includeCrm = sourceFilter === "both" || sourceFilter === "crm";

  const sources = {};

  if (includeJson) {
    const jsonProperties = getJsonProperties();
    const report = buildCoverageReport(jsonProperties, lang, "fallback_json");
    sources.json = {
      source: "fallback_json",
      summary: summarizeCoverage(report),
      rows: report,
    };
  }

  if (includeCrm) {
    const crmResult = await getCrmProperties();
    const report = buildCoverageReport(crmResult.properties, lang, crmResult.source);
    sources.crm = {
      source: crmResult.source,
      available: crmResult.available,
      summary: summarizeCoverage(report),
      rows: report,
    };
  }

  const comparison =
    sources.json && sources.crm && sources.crm.available
      ? compareCoverageReports(sources.json.rows, sources.crm.rows)
      : [];

  return {
    generated_at: new Date().toISOString(),
    lang,
    source_filter: sourceFilter,
    sources,
    comparison: {
      count: comparison.length,
      rows: comparison,
    },
  };
};

const writeOutput = (payload) => {
  if (!outputPathValue) return;

  const outputPath = path.resolve(repoRoot, outputPathValue);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  if (format === "csv") {
    const csvRows = [
      ...(payload.sources.json?.rows ?? []),
      ...(payload.sources.crm?.rows ?? []),
    ];
    fs.writeFileSync(outputPath, toCsv(csvRows), "utf8");
    return;
  }

  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
};

const logSummary = (payload) => {
  const summary = {
    lang: payload.lang,
    source_filter: payload.source_filter,
    json: payload.sources.json?.summary ?? null,
    crm: payload.sources.crm?.summary ?? null,
    comparison_mismatches: payload.comparison.count,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!outputPathValue && !hasFlag("--print-report")) {
    console.log("Use --out <path> to write the full per-property report.");
    return;
  }

  if (hasFlag("--print-report")) {
    console.log(JSON.stringify(payload, null, 2));
  }
};

try {
  const payload = await buildOutput();
  writeOutput(payload);
  logSummary(payload);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
