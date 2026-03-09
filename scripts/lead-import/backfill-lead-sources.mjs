import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_SOURCE_CATALOG_PATH = path.join("scripts", "lead-import", "reference", "lead-source-catalog.csv");
const PROPERTY_SELECT = "id, organization_id, legacy_code, parent_property_id, record_type";
const LEAD_SELECT =
  "id, organization_id, property_id, agency_id, provider_id, source, origin_type, raw_payload, updated_at, created_at";

const parseEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const split = line.indexOf("=");
    if (split <= 0) continue;
    const key = line.slice(0, split).trim();
    let value = line.slice(split + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
};

const envFileValues = {
  ...parseEnvFile(path.join(ROOT, ".env")),
  ...parseEnvFile(path.join(ROOT, ".env.local")),
};

const env = (name) => {
  const value = process.env[name] ?? envFileValues[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const arg = (name) => {
  const inlinePrefix = `--${name}=`;
  const inline = process.argv.find((part) => part.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};

const flag = (name) => process.argv.includes(`--${name}`);

const txt = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const isUuid = (value) => {
  const normalized = txt(value);
  return Boolean(normalized && UUID_RX.test(normalized));
};

const canonical = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const asObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const detectDelimiter = (rawText) => {
  const text = String(rawText ?? "");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = lines.reduce((sum, line) => sum + (line.split(candidate).length - 1), 0);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
};

const parseDelimited = (rawText, delimiter) => {
  const text = String(rawText ?? "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
  }

  row.push(field);
  if (row.some((value) => String(value ?? "").length > 0) || rows.length === 0) rows.push(row);
  return rows;
};

const buildLookup = (headers) => {
  const cleanHeaders = headers.map((header) =>
    String(header ?? "")
      .replace(/\r?\n/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
  const byExact = new Map();
  const canonicalHeaders = cleanHeaders.map((header) => canonical(header));
  canonicalHeaders.forEach((key, idx) => {
    if (!key) return;
    const bucket = byExact.get(key) ?? [];
    bucket.push(idx);
    byExact.set(key, bucket);
  });
  return { headers: cleanHeaders, canonicalHeaders, byExact };
};

const pickValue = (row, lookup, aliases) => {
  const aliasList = Array.isArray(aliases) ? aliases : [aliases];
  for (const aliasRaw of aliasList) {
    const alias = txt(String(aliasRaw ?? ""));
    if (!alias) continue;
    const key = canonical(alias);
    if (!key) continue;
    const exact = lookup.byExact.get(key) ?? [];
    for (const idx of exact) {
      const value = txt(row[idx]);
      if (value) return value;
    }
    for (let i = 0; i < lookup.canonicalHeaders.length; i += 1) {
      const headerKey = lookup.canonicalHeaders[i];
      if (!headerKey) continue;
      if (headerKey.includes(key) || key.includes(headerKey)) {
        const value = txt(row[i]);
        if (value) return value;
      }
    }
  }
  return null;
};

const normalizeSourceKey = (value, fallback = null) => {
  const text = txt(value);
  if (!text) return fallback;
  const emailMatch = text.match(/^([A-Z0-9._%+-]+)@([A-Z0-9.-]+\.[A-Z]{2,})$/i);
  if (emailMatch) {
    const local = canonical(emailMatch[1])?.replace(/\s+/g, "_") ?? "";
    const domain = canonical(emailMatch[2])
      ?.replace(/\s+/g, "_")
      .replace(/_com$|_es$|_net$|_org$/g, "") ?? "";
    const key = [local, domain].filter(Boolean).join("_");
    return key || fallback;
  }
  const normalized = canonical(text);
  if (!normalized) return fallback;
  return normalized.replace(/\s+/g, "_");
};

const normalizeOriginType = (value, fallback = "other") => {
  const text = txt(value);
  if (!text) return fallback;
  const normalizedEnum = text.toLowerCase().replace(/\s+/g, "_");
  if (
    normalizedEnum === "direct" ||
    normalizedEnum === "website" ||
    normalizedEnum === "portal" ||
    normalizedEnum === "agency" ||
    normalizedEnum === "provider" ||
    normalizedEnum === "phone" ||
    normalizedEnum === "whatsapp" ||
    normalizedEnum === "email" ||
    normalizedEnum === "other"
  ) {
    return normalizedEnum;
  }

  const c = canonical(text);
  if (!c) return fallback;
  if (
    c.includes("idealista") ||
    c.includes("fotocasa") ||
    c.includes("inmowi") ||
    c.includes("clinmo") ||
    c.includes("pisos com") ||
    c.includes("resales online") ||
    c.includes("portal")
  ) {
    return "portal";
  }
  if (
    c.includes("landing") ||
    c.includes("formulario web") ||
    c.includes("web br") ||
    c.includes("google") ||
    c.includes("meta") ||
    c.includes("redes sociales") ||
    c.includes("mailing") ||
    c.includes("mail lanzamiento") ||
    c.includes("valla")
  ) {
    return "website";
  }
  if (c.includes("agenc")) return "agency";
  if (c.includes("proveedor") || c.includes("provider")) return "provider";
  if (c.includes("telefono") || c.includes("llamada") || c.includes("phone")) return "phone";
  if (c.includes("whatsapp") || c.includes("wa ")) return "whatsapp";
  if (text.includes("@") || c.includes("email") || c.includes("correo") || c.includes("mail")) return "email";
  if (
    c.includes("direct") ||
    c.includes("cliente") ||
    c.includes("interno") ||
    c.includes("referenciad") ||
    c.includes("oficina") ||
    c.includes("paseaban")
  ) {
    return "direct";
  }
  return fallback;
};

const loadLeadSourceCatalog = (catalogFileRaw) => {
  const relativePath = txt(catalogFileRaw) ?? DEFAULT_SOURCE_CATALOG_PATH;
  const absolutePath = path.isAbsolute(relativePath) ? relativePath : path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return {
      absolute_path: null,
      relative_path: relativePath,
      entries_total: 0,
      byCanonicalRaw: new Map(),
    };
  }

  const raw = fs.readFileSync(absolutePath, "utf8");
  const delimiter = detectDelimiter(raw);
  const parsed = parseDelimited(raw, delimiter);
  const lookup = buildLookup(parsed[0] ?? []);
  const byCanonicalRaw = new Map();

  for (let i = 1; i < parsed.length; i += 1) {
    const current = lookup.headers.map((_, idx) => txt(parsed[i]?.[idx]) ?? "");
    const rawValue = pickValue(current, lookup, ["raw_value", "raw value"]);
    if (!rawValue) continue;
    byCanonicalRaw.set(canonical(rawValue), {
      raw_value: rawValue,
      channel_detail: normalizeSourceKey(pickValue(current, lookup, ["channel_detail", "channel detail"]), null),
      origin_type: normalizeOriginType(pickValue(current, lookup, ["origin_type", "origin type"]), "other"),
      source_label: txt(pickValue(current, lookup, ["source_label", "source label"])) ?? rawValue,
      decision_status: txt(pickValue(current, lookup, ["decision_status", "decision status"])) ?? "ready",
      notes: txt(pickValue(current, lookup, ["notes", "note"])),
    });
  }

  return {
    absolute_path: absolutePath,
    relative_path: path.relative(ROOT, absolutePath),
    entries_total: byCanonicalRaw.size,
    byCanonicalRaw,
  };
};

const fetchAllRows = async ({ db, table, select, organizationId, orderBy = "updated_at", ascending = false, pageSize = 1000 }) => {
  const rows = [];
  let from = 0;

  while (true) {
    let query = db
      .schema("crm")
      .from(table)
      .select(select)
      .eq("organization_id", organizationId)
      .range(from, from + pageSize - 1);

    if (orderBy) query = query.order(orderBy, { ascending });
    const { data, error } = await query;
    if (error) throw error;

    if (!Array.isArray(data) || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += data.length;
  }

  return rows;
};

const loadPropertiesIndex = async (db, organizationId) => {
  const data = await fetchAllRows({
    db,
    table: "properties",
    select: PROPERTY_SELECT,
    organizationId,
    orderBy: "id",
    ascending: true,
  });

  const byId = new Map();
  const byLegacy = new Map();
  for (const row of data ?? []) {
    const id = txt(row.id);
    if (id) byId.set(id, row);
    const legacy = txt(row.legacy_code);
    if (legacy) byLegacy.set(legacy.toLowerCase(), row);
  }
  return { byId, byLegacy };
};

const resolveLeadChannel = ({ rawValue, currentSource, currentOriginType, sourceCatalog }) => {
  const effectiveRaw = txt(rawValue) ?? txt(currentSource) ?? txt(currentOriginType);
  const catalogEntry = effectiveRaw ? sourceCatalog.byCanonicalRaw.get(canonical(effectiveRaw)) ?? null : null;
  return {
    raw_value: effectiveRaw,
    channel_detail:
      txt(catalogEntry?.channel_detail) ??
      normalizeSourceKey(effectiveRaw, null) ??
      normalizeSourceKey(currentSource, null) ??
      "csv_import",
    origin_type: normalizeOriginType(
      txt(catalogEntry?.origin_type) ?? effectiveRaw ?? txt(currentOriginType),
      normalizeOriginType(currentOriginType, "other")
    ),
    source_label: txt(catalogEntry?.source_label) ?? effectiveRaw ?? txt(currentSource) ?? "Importacion CSV",
    decision_status: txt(catalogEntry?.decision_status) ?? (effectiveRaw ? "heuristic" : "fallback"),
    notes: txt(catalogEntry?.notes),
    matched_from_catalog: Boolean(catalogEntry),
  };
};

const resolvePersistedOriginType = ({ lead, requestedOriginType }) => {
  let originType = normalizeOriginType(requestedOriginType, normalizeOriginType(txt(lead.origin_type), "other"));
  const agencyId = isUuid(lead.agency_id) ? txt(lead.agency_id) : null;
  const providerId = isUuid(lead.provider_id) ? txt(lead.provider_id) : null;
  if (originType === "agency" && !agencyId) originType = "other";
  if (originType === "provider" && !providerId) originType = "other";
  return originType;
};

const readRawRowChannel = (rawRow) =>
  txt(rawRow["CANAL DE ENTRADA"]) ??
  txt(rawRow["ORIGEN"]) ??
  txt(rawRow.Origen) ??
  txt(rawRow.Canal);

const extractChannelRawFromLead = (lead) => {
  const rawPayload = asObject(lead.raw_payload);
  const channel = asObject(rawPayload.channel);
  const mapped = asObject(rawPayload.mapped);
  const rawRow = asObject(rawPayload.raw_row);

  return (
    txt(channel.raw_value) ??
    txt(mapped.channel_raw) ??
    txt(mapped.source_raw) ??
    readRawRowChannel(rawRow) ??
    txt(mapped.origin_type_raw) ??
    txt(lead.source)
  );
};

const resolvePropertyContext = ({ lead, propertiesIndex }) => {
  const rawPayload = asObject(lead.raw_payload);
  const mapped = asObject(rawPayload.mapped);
  const projectPayload = asObject(rawPayload.project);
  const currentPropertyId = txt(lead.property_id);
  const propertyFromCurrent = currentPropertyId ? propertiesIndex.byId.get(currentPropertyId) ?? null : null;
  const legacyCode =
    txt(mapped.property_legacy_code) ??
    txt(projectPayload.property_legacy_code) ??
    txt(projectPayload.project_legacy_code);
  const propertyFromLegacy = legacyCode ? propertiesIndex.byLegacy.get(legacyCode.toLowerCase()) ?? null : null;
  const property = propertyFromCurrent ?? propertyFromLegacy ?? null;
  const associationSource = propertyFromCurrent ? "existing_property_id" : propertyFromLegacy ? "legacy_code" : null;

  let project = null;
  if (property) {
    const parentId = txt(property.parent_property_id);
    project = parentId ? propertiesIndex.byId.get(parentId) ?? null : null;
    if (!project) project = property;
  }

  return {
    current_property_id: currentPropertyId,
    property_id: txt(property?.id),
    property_legacy_code: txt(property?.legacy_code) ?? legacyCode,
    property_record_type: txt(property?.record_type),
    project_id: txt(project?.id),
    project_legacy_code: txt(project?.legacy_code),
    project_record_type: txt(project?.record_type),
    association_source: associationSource,
    requested_legacy_code: legacyCode,
  };
};

const stableStringify = (value) => JSON.stringify(value);

const buildBackfilledRawPayload = ({
  lead,
  currentRawPayload,
  channelContext,
  persistedOriginType,
  propertyContext,
  sourceCatalog,
  runStamp,
}) => {
  const mapped = asObject(currentRawPayload.mapped);
  const importPayload = asObject(currentRawPayload.import);

  return {
    ...currentRawPayload,
    import: {
      ...importPayload,
      backfilled_at: runStamp,
      backfill_script: "scripts/lead-import/backfill-lead-sources.mjs",
      source_catalog: sourceCatalog.relative_path,
    },
    channel: {
      ...asObject(currentRawPayload.channel),
      raw_value: txt(channelContext.raw_value),
      channel_detail: channelContext.channel_detail,
      source_label: channelContext.source_label,
      origin_type: persistedOriginType,
      catalog_origin_type: channelContext.origin_type,
      decision_status: channelContext.decision_status,
      notes: channelContext.notes,
      matched_from_catalog: channelContext.matched_from_catalog,
    },
    project: {
      ...asObject(currentRawPayload.project),
      property_id: propertyContext.property_id,
      property_legacy_code: propertyContext.property_legacy_code,
      property_record_type: propertyContext.property_record_type,
      project_id: propertyContext.project_id,
      project_legacy_code: propertyContext.project_legacy_code,
      project_record_type: propertyContext.project_record_type,
      association_source: propertyContext.association_source,
      requested_legacy_code: propertyContext.requested_legacy_code,
    },
    mapped: {
      ...mapped,
      channel_raw: txt(channelContext.raw_value),
      channel_detail: channelContext.channel_detail,
      source_label: channelContext.source_label,
      property_id: propertyContext.property_id,
      property_legacy_code: propertyContext.property_legacy_code ?? txt(mapped.property_legacy_code),
      project_id: propertyContext.project_id,
      project_legacy_code: propertyContext.project_legacy_code,
    },
    backfill: {
      run_at: runStamp,
      channel_detail: channelContext.channel_detail,
      origin_type: persistedOriginType,
      catalog_origin_type: channelContext.origin_type,
      project_id: propertyContext.project_id,
      property_id: propertyContext.property_id,
    },
  };
};

const bumpCounter = (map, key) => {
  const normalizedKey = txt(key);
  if (!normalizedKey) return;
  map.set(normalizedKey, (map.get(normalizedKey) ?? 0) + 1);
};

const sortedCounterEntries = (map, keyName) =>
  Array.from(map.entries())
    .map(([key, count]) => ({ [keyName]: key, count }))
    .sort((left, right) => right.count - left.count || String(left[keyName]).localeCompare(String(right[keyName])));

const help = () => {
  console.log(`
Uso:
  node scripts/lead-import/backfill-lead-sources.mjs [opciones]

Opciones:
  --organization-id <uuid>    Sobrescribe organization_id
  --catalog-file <ruta>       Sobrescribe catalogo de canales
  --apply                     Aplica cambios en base de datos
  --limit <n>                 Limita filas evaluadas
  --include-manual            Incluye leads manuales, no solo importados
  --help                      Muestra esta ayuda
`);
};

const run = async () => {
  if (flag("help")) {
    help();
    return;
  }

  const organizationId =
    txt(arg("organization-id")) ??
    txt(env("CRM_ORGANIZATION_ID")) ??
    txt(env("PUBLIC_CRM_ORGANIZATION_ID"));
  if (!organizationId || !UUID_RX.test(organizationId)) {
    throw new Error("organization_id_required_uuid");
  }

  const supabaseUrl = env("SUPABASE_URL") ?? env("PUBLIC_SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("missing_supabase_credentials");

  const apply = flag("apply");
  const includeManual = flag("include-manual");
  const limitValue = Number(arg("limit"));
  const limit = Number.isFinite(limitValue) && limitValue > 0 ? Math.floor(limitValue) : null;
  const runStamp = new Date().toISOString();

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const sourceCatalog = loadLeadSourceCatalog(arg("catalog-file"));
  const propertiesIndex = await loadPropertiesIndex(db, organizationId);
  const leads = await fetchAllRows({
    db,
    table: "leads",
    select: LEAD_SELECT,
    organizationId,
    orderBy: "updated_at",
    ascending: false,
  });

  const stats = {
    apply,
    include_manual: includeManual,
    organization_id: organizationId,
    leads_scanned: 0,
    leads_eligible: 0,
    leads_updated: 0,
    leads_unchanged: 0,
    skipped_non_imported: 0,
    unresolved_property_links: 0,
    source_catalog_entries: sourceCatalog.entries_total,
    source_catalog_path: sourceCatalog.relative_path,
    errors: 0,
  };

  const unresolvedChannelValues = new Map();
  const pendingBusinessChannels = new Map();
  const channelSummary = new Map();
  const originSummary = new Map();
  const unresolvedPropertyCodes = new Map();
  const projectAssociationSummary = {
    with_property: 0,
    with_project: 0,
    without_project: 0,
  };
  const updatesPreview = [];
  const failures = [];

  for (const lead of leads) {
    if (limit && stats.leads_scanned >= limit) break;
    stats.leads_scanned += 1;

    try {
      const currentRawPayload = asObject(lead.raw_payload);
      const importPayload = asObject(currentRawPayload.import);
      const isImportedLead = Boolean(txt(importPayload.source_file) || txt(importPayload.source_path));
      if (!isImportedLead && !includeManual) {
        stats.skipped_non_imported += 1;
        continue;
      }

      stats.leads_eligible += 1;
      const channelRaw = extractChannelRawFromLead(lead);
      const channelContext = resolveLeadChannel({
        rawValue: channelRaw,
        currentSource: txt(lead.source),
        currentOriginType: txt(lead.origin_type),
        sourceCatalog,
      });
      const persistedOriginType = resolvePersistedOriginType({
        lead,
        requestedOriginType: channelContext.origin_type,
      });
      const propertyContext = resolvePropertyContext({ lead, propertiesIndex });

      bumpCounter(channelSummary, channelContext.channel_detail);
      bumpCounter(originSummary, persistedOriginType);
      if (txt(channelContext.raw_value) && !channelContext.matched_from_catalog) {
        bumpCounter(unresolvedChannelValues, channelContext.raw_value);
      }
      if (channelContext.decision_status === "pending_business" && txt(channelContext.raw_value)) {
        bumpCounter(pendingBusinessChannels, channelContext.raw_value);
      }
      if (propertyContext.property_id) projectAssociationSummary.with_property += 1;
      if (propertyContext.project_id) projectAssociationSummary.with_project += 1;
      else projectAssociationSummary.without_project += 1;
      if (!propertyContext.property_id && txt(propertyContext.requested_legacy_code)) {
        stats.unresolved_property_links += 1;
        bumpCounter(unresolvedPropertyCodes, propertyContext.requested_legacy_code);
      }

      const currentPropertyId = txt(lead.property_id);
      const nextPropertyId =
        currentPropertyId && propertiesIndex.byId.has(currentPropertyId)
          ? currentPropertyId
          : propertyContext.property_id;

      const nextRawPayload = buildBackfilledRawPayload({
        lead,
        currentRawPayload,
        channelContext,
        persistedOriginType,
        propertyContext: {
          ...propertyContext,
          property_id: nextPropertyId,
        },
        sourceCatalog,
        runStamp,
      });

      const updatePayload = {};
      if (txt(lead.source) !== channelContext.channel_detail) updatePayload.source = channelContext.channel_detail;
      if (txt(lead.origin_type) !== persistedOriginType) updatePayload.origin_type = persistedOriginType;
      if (nextPropertyId && currentPropertyId !== nextPropertyId) updatePayload.property_id = nextPropertyId;
      if (stableStringify(currentRawPayload) !== stableStringify(nextRawPayload)) {
        updatePayload.raw_payload = nextRawPayload;
      }

      if (Object.keys(updatePayload).length === 0) {
        stats.leads_unchanged += 1;
        continue;
      }

      if (updatesPreview.length < 200) {
        updatesPreview.push({
          lead_id: txt(lead.id),
          source_before: txt(lead.source),
          source_after: channelContext.channel_detail,
          origin_type_before: txt(lead.origin_type),
          origin_type_after: persistedOriginType,
          property_id_before: currentPropertyId,
          property_id_after: nextPropertyId,
          project_id_after: propertyContext.project_id,
          project_legacy_code_after: propertyContext.project_legacy_code,
          channel_raw: txt(channelContext.raw_value),
          decision_status: channelContext.decision_status,
        });
      }

      if (apply) {
        const { error } = await db
          .schema("crm")
          .from("leads")
          .update(updatePayload)
          .eq("organization_id", organizationId)
          .eq("id", lead.id);
        if (error) throw new Error(`db_lead_update_error:${error.message}`);
      }

      stats.leads_updated += 1;
    } catch (error) {
      stats.errors += 1;
      failures.push({
        lead_id: txt(lead.id),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const report = {
    ok: stats.errors === 0,
    generated_at: runStamp,
    organization_id: organizationId,
    stats,
    analytics: {
      by_channel_detail: sortedCounterEntries(channelSummary, "channel_detail").slice(0, 200),
      by_origin_type: sortedCounterEntries(originSummary, "origin_type").slice(0, 50),
      unresolved_channel_values: sortedCounterEntries(unresolvedChannelValues, "raw_value").slice(0, 200),
      pending_business_channels: sortedCounterEntries(pendingBusinessChannels, "raw_value").slice(0, 200),
      unresolved_property_codes: sortedCounterEntries(unresolvedPropertyCodes, "legacy_code").slice(0, 200),
      project_association: projectAssociationSummary,
    },
    updates_preview: updatesPreview,
    updates_omitted: Math.max(0, stats.leads_updated - updatesPreview.length),
    failures_preview: failures.slice(0, 200),
    failures_omitted: Math.max(0, failures.length - 200),
  };

  const reportsDir = path.join(ROOT, "scripts", "lead-import", "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const stamp = runStamp.replace(/[:.]/g, "-");
  const reportPath = path.join(reportsDir, `leads-backfill-${stamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: stats.errors === 0,
        report_path: reportPath,
        stats,
      },
      null,
      2
    )
  );

  if (stats.errors > 0) {
    process.exitCode = 1;
  }
};

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
