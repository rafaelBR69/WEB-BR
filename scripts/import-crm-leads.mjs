import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LEAD_STATUSES = new Set([
  "new",
  "in_process",
  "qualified",
  "visit_scheduled",
  "offer_sent",
  "negotiation",
  "converted",
  "won",
  "lost",
  "discarded",
  "junk",
]);
const LEAD_ORIGINS = new Set([
  "direct",
  "website",
  "portal",
  "agency",
  "provider",
  "phone",
  "whatsapp",
  "email",
  "other",
]);
const LEAD_KINDS = new Set(["buyer", "seller", "landlord", "tenant", "investor", "agency", "provider", "other"]);
const OPERATION_INTERESTS = new Set(["sale", "rent", "both"]);

const CONTACT_SELECT = "id, organization_id, contact_type, full_name, email, phone, country_code, updated_at, created_at";
const CLIENT_SELECT = "id, organization_id, contact_id, tax_id, client_status, updated_at";
const LEAD_SELECT =
  "id, organization_id, contact_id, property_id, source, origin_type, lead_kind, status, operation_interest, updated_at, created_at";
const PROPERTY_SELECT = "id, organization_id, legacy_code, parent_property_id, record_type";
const DEFAULT_SOURCE_CATALOG_PATH = path.join("scripts", "lead-import", "reference", "lead-source-catalog.csv");
const PRIMARY_CHANNEL_ALIASES = ["CANAL DE ENTRADA"];
const FALLBACK_CHANNEL_ALIASES = ["ORIGEN", "Origen", "Canal"];

const DEFAULT_COLUMN_ALIASES = {
  full_name: ["nombre", "nombre completo", "contacto", "lead", "cliente", "interesado"],
  email: ["email", "correo", "mail", "e-mail"],
  phone: ["telefono", "telefono 1", "telefono 2", "movil", "phone", "whatsapp"],
  nationality: ["nacionalidad", "nacionalidad cliente", "nacionalidad lead", "pais", "país", "country", "nacion"],
  tax_id: ["dni", "nie", "nif", "cif", "pasaporte", "documento", "id fiscal"],
  status: ["estado", "status", "fase", "etapa", "resultado"],
  lead_kind: ["tipo lead", "tipo de lead", "lead kind", "tipo"],
  origin_type: ["origen", "canal", "fuente", "channel", "origin"],
  source: [
    "source",
    "origen detalle",
    "fuente detalle",
    "campana",
    "campana origen",
    "canal de entrada",
    "canal",
    "origen",
    "channel",
  ],
  operation_interest: ["interes", "interes operacion", "operacion", "operacion interes", "operation interest"],
  property_legacy_code: ["promocion", "codigo promocion", "legacy code", "property code", "project code", "unidad"],
  message: ["mensaje", "comentario", "comentarios", "notas", "observaciones"],
  discarded_reason: ["motivo baja", "razon baja", "motivo descarte", "discard reason"],
  agency_id: ["agency_id", "id agencia", "agencia id"],
  provider_id: ["provider_id", "id proveedor", "proveedor id"],
};

const DEFAULT_SKIP_STATUS_TOKENS = [
  "cliente",
  "client",
  "customer",
  "baja",
  "converted",
  "convertido",
  "ya ha comprado",
];

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

const low = (value) => {
  const text = txt(value);
  return text ? text.toLowerCase() : null;
};

const toArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
};

const canonical = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const isUuid = (value) => {
  const text = txt(value);
  return Boolean(text && UUID_RX.test(text));
};

const normalizePhone = (value) => {
  const text = txt(value);
  if (!text) return null;
  const digits = text.replace(/\D+/g, "");
  return digits.length >= 6 ? digits : null;
};

const normalizeTaxId = (value) => {
  const text = txt(value);
  if (!text) return null;
  return text.toUpperCase().replace(/\s+/g, "").replace(/[-.]/g, "");
};

const normalizeNationality = (value) => {
  const text = txt(value);
  if (!text) return null;
  return text.replace(/\s+/g, " ");
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

const normalizeEnum = (value, allowed) => {
  const text = txt(value);
  if (!text) return null;
  const normalized = text.toLowerCase().replace(/\s+/g, "_");
  return allowed.has(normalized) ? normalized : null;
};

const firstEmail = (value) => {
  const text = txt(value);
  if (!text) return null;
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : low(text);
};

const parseDate = (value) => {
  const text = txt(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const m = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (!Number.isFinite(d) || !Number.isFinite(mo) || !Number.isFinite(y)) return null;
  if (y < 100) y += 2000;
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

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

const detectHeaderIndex = (rows) => {
  let bestIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
    const sample = rows[i].map((value) => txt(value)).filter(Boolean);
    if (!sample.length) continue;
    const line = canonical(sample.join(" "));
    const score =
      sample.length +
      (line.includes("nombre") ? 3 : 0) +
      (line.includes("email") || line.includes("correo") || line.includes("mail") ? 3 : 0) +
      (line.includes("telefono") || line.includes("movil") ? 3 : 0) +
      (line.includes("estado") || line.includes("status") ? 2 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
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

const toAliasList = (value) =>
  toArray(value)
    .map((item) => txt(String(item ?? "")))
    .filter(Boolean);

const resolveAliases = (sourceColumns, fieldName) => {
  const fromSource = toAliasList(sourceColumns?.[fieldName]);
  const fromDefaults = DEFAULT_COLUMN_ALIASES[fieldName] ?? [];
  return [...fromSource, ...fromDefaults];
};

const pickValue = (row, lookup, aliases) => {
  const aliasList = toAliasList(aliases);
  for (const alias of aliasList) {
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

const buildRawRow = (headers, row) => {
  const out = {};
  headers.forEach((header, idx) => {
    out[txt(header) ?? `col_${idx + 1}`] = txt(row[idx]);
  });
  return out;
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

const loadLeadSourceCatalog = (catalogFileRaw) => {
  const relativePath = txt(catalogFileRaw) ?? DEFAULT_SOURCE_CATALOG_PATH;
  const absolutePath = path.isAbsolute(relativePath) ? relativePath : path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return {
      absolute_path: null,
      relative_path: txt(relativePath),
      entries_total: 0,
      byCanonicalRaw: new Map(),
    };
  }

  const raw = fs.readFileSync(absolutePath, "utf8");
  const delimiter = detectDelimiter(raw);
  const parsed = parseDelimited(raw, delimiter);
  if (!parsed.length) {
    return {
      absolute_path: absolutePath,
      relative_path: path.relative(ROOT, absolutePath),
      entries_total: 0,
      byCanonicalRaw: new Map(),
    };
  }

  const lookup = buildLookup(parsed[0] ?? []);
  const byCanonicalRaw = new Map();

  for (let i = 1; i < parsed.length; i += 1) {
    const current = lookup.headers.map((_, idx) => txt(parsed[i]?.[idx]) ?? "");
    const rawValue = pickValue(current, lookup, ["raw_value", "raw value"]);
    if (!rawValue) continue;

    const entry = {
      raw_value: rawValue,
      channel_detail: normalizeSourceKey(pickValue(current, lookup, ["channel_detail", "channel detail"]), null),
      origin_type: normalizeOriginType(pickValue(current, lookup, ["origin_type", "origin type"]), "other"),
      source_label: txt(pickValue(current, lookup, ["source_label", "source label"])) ?? rawValue,
      decision_status: txt(pickValue(current, lookup, ["decision_status", "decision status"])) ?? "ready",
      notes: txt(pickValue(current, lookup, ["notes", "note"])),
    };

    byCanonicalRaw.set(canonical(rawValue), entry);
  }

  return {
    absolute_path: absolutePath,
    relative_path: path.relative(ROOT, absolutePath),
    entries_total: byCanonicalRaw.size,
    byCanonicalRaw,
  };
};

const resolveLeadChannel = ({ row, defaults, sourceMeta, sourceCatalog }) => {
  const rawValue =
    txt(row.channel_raw) ??
    txt(row.source_raw) ??
    txt(row.origin_type_raw) ??
    txt(defaults.source) ??
    txt(defaults.origin_type);
  const catalogEntry = rawValue ? sourceCatalog.byCanonicalRaw.get(canonical(rawValue)) ?? null : null;
  const fallbackSourceKey = normalizeSourceKey(`csv_import_${sourceMeta.source_file_name}`, null);
  const channelDetail =
    txt(catalogEntry?.channel_detail) ??
    normalizeSourceKey(rawValue, null) ??
    normalizeSourceKey(defaults.source, null) ??
    fallbackSourceKey ??
    "csv_import";
  const originType = normalizeOriginType(
    txt(catalogEntry?.origin_type) ?? rawValue ?? txt(defaults.origin_type),
    normalizeOriginType(defaults.origin_type, "other")
  );

  return {
    raw_value: rawValue,
    channel_detail: channelDetail,
    origin_type: originType,
    source_label: txt(catalogEntry?.source_label) ?? rawValue ?? channelDetail,
    decision_status: txt(catalogEntry?.decision_status) ?? (rawValue ? "heuristic" : "fallback"),
    notes: txt(catalogEntry?.notes),
    matched_from_catalog: Boolean(catalogEntry),
  };
};

const resolvePropertyContext = ({ propertiesIndex, rowPropertyCode, defaultPropertyCode }) => {
  const normalizedRowCode = txt(rowPropertyCode);
  const normalizedDefaultCode = txt(defaultPropertyCode);
  const rowProperty = normalizedRowCode ? propertiesIndex.byLegacy.get(normalizedRowCode.toLowerCase()) ?? null : null;
  const defaultProperty =
    !rowProperty && normalizedDefaultCode ? propertiesIndex.byLegacy.get(normalizedDefaultCode.toLowerCase()) ?? null : null;
  const property = rowProperty ?? defaultProperty ?? null;
  const associationSource = rowProperty ? "row" : defaultProperty ? "source_default" : null;

  let project = null;
  if (property) {
    const parentId = txt(property.parent_property_id);
    project = parentId ? propertiesIndex.byId.get(parentId) ?? null : null;
    if (!project) project = property;
  }

  return {
    property_id: txt(property?.id),
    property_legacy_code: txt(property?.legacy_code),
    property_record_type: txt(property?.record_type),
    project_id: txt(project?.id),
    project_legacy_code: txt(project?.legacy_code),
    project_record_type: txt(project?.record_type),
    association_source: associationSource,
    requested_legacy_code: normalizedRowCode ?? normalizedDefaultCode,
    requested_row_legacy_code: normalizedRowCode,
    default_property_legacy_code: normalizedDefaultCode,
  };
};

const normalizeLeadStatus = (value, fallback = "new") => {
  const exact = normalizeEnum(value, LEAD_STATUSES);
  if (exact) return exact;
  const c = canonical(value);
  if (!c) return fallback;
  if (c.includes("nuevo")) return "new";
  if (c.includes("proceso") || c.includes("seguimiento")) return "in_process";
  if (c.includes("cualific")) return "qualified";
  if (c.includes("visita")) return "visit_scheduled";
  if (c.includes("oferta")) return "offer_sent";
  if (c.includes("negoci")) return "negotiation";
  if (c.includes("ganad") || c.includes("cerrad") || c.includes("won")) return "won";
  if (c.includes("perdid") || c.includes("lost")) return "lost";
  if (c.includes("basura") || c.includes("spam") || c.includes("junk")) return "junk";
  if (c.includes("convert") || c.includes("cliente")) return "converted";
  if (c.includes("baja") || c.includes("descart")) return "discarded";
  return fallback;
};

const normalizeLeadKind = (value, fallback = "buyer") => {
  const exact = normalizeEnum(value, LEAD_KINDS);
  if (exact) return exact;
  const c = canonical(value);
  if (!c) return fallback;
  if (c.includes("seller") || c.includes("vendedor")) return "seller";
  if (c.includes("landlord") || c.includes("propietario")) return "landlord";
  if (c.includes("tenant") || c.includes("inquilino")) return "tenant";
  if (c.includes("invers")) return "investor";
  if (c.includes("agenc")) return "agency";
  if (c.includes("proveedor") || c.includes("provider")) return "provider";
  return fallback;
};

const normalizeOriginType = (value, fallback = "other") => {
  const exact = normalizeEnum(value, LEAD_ORIGINS);
  if (exact) return exact;
  const c = canonical(value);
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
  if (c.includes("whatsapp")) return "whatsapp";
  if (c.includes("wa ")) return "whatsapp";
  if (c.includes("email") || c.includes("correo") || c.includes("mail") || c.includes("@")) return "email";
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

const normalizeOperationInterest = (value, fallback = "sale") => {
  const exact = normalizeEnum(value, OPERATION_INTERESTS);
  if (exact) return exact;
  const c = canonical(value);
  if (!c) return fallback;
  const hasSale = c.includes("venta") || c.includes("compra") || c.includes("sale") || c.includes("buy");
  const hasRent = c.includes("alquiler") || c.includes("rent") || c.includes("arrend");
  if (hasSale && hasRent) return "both";
  if (hasRent) return "rent";
  return "sale";
};

const shouldSkipByCsvStatus = (statusRaw, skipTokens) => {
  const c = canonical(statusRaw);
  if (!c) return false;
  for (const token of skipTokens) {
    const key = canonical(token);
    if (key && c.includes(key)) return true;
  }
  return false;
};

const help = () => {
  console.log(`
Uso:
  node scripts/import-crm-leads.mjs --job-file <file.json> [opciones]

Opciones:
  --organization-id <uuid>  Sobrescribe organization_id del job
  --dry-run                 Simula sin insertar/actualizar en base de datos
  --update-existing         Si existe lead por identidad, actualiza
  --continue-on-error       Continua aunque haya filas con error
  --limit <n>               Limita el total de filas procesadas
  --help                    Muestra esta ayuda
`);
};

const readJob = (jobFile) => {
  const absolutePath = path.isAbsolute(jobFile) ? jobFile : path.join(ROOT, jobFile);
  if (!fs.existsSync(absolutePath)) throw new Error(`job_file_not_found:${absolutePath}`);
  const payload = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  return { absolutePath, payload };
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

const loadContactsIndex = async (db, organizationId) => {
  let data;
  try {
    data = await fetchAllRows({
      db,
      table: "contacts",
      select: CONTACT_SELECT,
      organizationId,
      orderBy: "updated_at",
      ascending: false,
    });
  } catch (error) {
    throw new Error(`db_contacts_read_error:${error.message}`);
  }

  const index = { byId: new Map(), byEmail: new Map(), byPhone: new Map() };
  for (const row of data ?? []) {
    const id = txt(row.id);
    if (id && !index.byId.has(id)) index.byId.set(id, row);

    const email = low(row.email);
    if (email && !index.byEmail.has(email)) index.byEmail.set(email, row);

    const phone = normalizePhone(row.phone);
    if (phone && !index.byPhone.has(phone)) index.byPhone.set(phone, row);
  }
  return index;
};

const addContactToIndex = (index, contact) => {
  const id = txt(contact?.id);
  if (id) index.byId.set(id, contact);
  const email = low(contact?.email);
  if (email) index.byEmail.set(email, contact);
  const phone = normalizePhone(contact?.phone);
  if (phone) index.byPhone.set(phone, contact);
};

const loadClientsIndex = async (db, organizationId, contactsIndex) => {
  let data;
  try {
    data = await fetchAllRows({
      db,
      table: "clients",
      select: CLIENT_SELECT,
      organizationId,
      orderBy: "updated_at",
      ascending: false,
    });
  } catch (error) {
    throw new Error(`db_clients_read_error:${error.message}`);
  }

  const index = { byTax: new Map(), byEmail: new Map(), byPhone: new Map() };
  for (const row of data ?? []) {
    const taxId = normalizeTaxId(row.tax_id);
    if (taxId && !index.byTax.has(taxId)) index.byTax.set(taxId, row);

    const contact = txt(row.contact_id) ? contactsIndex.byId.get(String(row.contact_id)) ?? null : null;
    const email = low(contact?.email);
    if (email && !index.byEmail.has(email)) index.byEmail.set(email, row);

    const phone = normalizePhone(contact?.phone);
    if (phone && !index.byPhone.has(phone)) index.byPhone.set(phone, row);
  }
  return index;
};

const extractLeadTaxId = (leadRow) => {
  const raw = leadRow?.raw_payload;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidateA = normalizeTaxId(raw.tax_id);
  if (candidateA) return candidateA;
  const mapped = raw.mapped;
  if (mapped && typeof mapped === "object" && !Array.isArray(mapped)) {
    const candidateB = normalizeTaxId(mapped.tax_id);
    if (candidateB) return candidateB;
  }
  return null;
};

const normalizeImportFileName = (value) => {
  const text = txt(value);
  return text ? text.toLowerCase() : null;
};

const leadImportKeyFromPayload = (rawPayload) => {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return null;
  const importMeta =
    rawPayload.import && typeof rawPayload.import === "object" && !Array.isArray(rawPayload.import)
      ? rawPayload.import
      : null;
  if (!importMeta) return null;
  const sourceFile = normalizeImportFileName(importMeta.source_file);
  const sourceRow = Number(importMeta.source_row_number);
  if (!sourceFile || !Number.isInteger(sourceRow) || sourceRow <= 0) return null;
  return `${sourceFile}#${sourceRow}`;
};

const rowImportKey = (row, sourceMeta) => {
  const sourceFile = normalizeImportFileName(sourceMeta?.source_file_name);
  const sourceRow = Number(row?.source_row_number);
  if (!sourceFile || !Number.isInteger(sourceRow) || sourceRow <= 0) return null;
  return `${sourceFile}#${sourceRow}`;
};

const loadLeadsIndex = async (db, organizationId, contactsIndex) => {
  let data;
  try {
    data = await fetchAllRows({
      db,
      table: "leads",
      select: "id, organization_id, contact_id, status, raw_payload, updated_at, created_at",
      organizationId,
      orderBy: "updated_at",
      ascending: false,
    });
  } catch (error) {
    throw new Error(`db_leads_read_error:${error.message}`);
  }

  const index = { byId: new Map(), byContact: new Map(), byEmail: new Map(), byPhone: new Map(), byTax: new Map(), byImport: new Map() };
  for (const row of data ?? []) {
    const id = txt(row.id);
    if (id && !index.byId.has(id)) index.byId.set(id, row);
    const contactId = txt(row.contact_id);
    if (contactId && !index.byContact.has(contactId)) index.byContact.set(contactId, row);
    const contact = contactId ? contactsIndex.byId.get(contactId) ?? null : null;
    const email = low(contact?.email);
    if (email && !index.byEmail.has(email)) index.byEmail.set(email, row);
    const phone = normalizePhone(contact?.phone);
    if (phone && !index.byPhone.has(phone)) index.byPhone.set(phone, row);
    const taxId = extractLeadTaxId(row);
    if (taxId && !index.byTax.has(taxId)) index.byTax.set(taxId, row);
    const importKey = leadImportKeyFromPayload(row.raw_payload);
    if (importKey && !index.byImport.has(importKey)) index.byImport.set(importKey, row);
  }
  return index;
};

const indexLeadIdentity = (leadsIndex, leadRow, contactRow, taxId, row, sourceMeta) => {
  const id = txt(leadRow?.id);
  if (id) leadsIndex.byId.set(id, leadRow);
  const contactId = txt(leadRow?.contact_id ?? contactRow?.id);
  if (contactId) leadsIndex.byContact.set(contactId, leadRow);
  const email = low(contactRow?.email);
  if (email) leadsIndex.byEmail.set(email, leadRow);
  const phone = normalizePhone(contactRow?.phone);
  if (phone) leadsIndex.byPhone.set(phone, leadRow);
  const tax = normalizeTaxId(taxId);
  if (tax) leadsIndex.byTax.set(tax, leadRow);
  const keyFromLead = leadImportKeyFromPayload(leadRow?.raw_payload);
  const keyFromRow = rowImportKey(row, sourceMeta);
  const importKey = keyFromLead ?? keyFromRow;
  if (importKey) leadsIndex.byImport.set(importKey, leadRow);
};

const loadPropertiesIndex = async (db, organizationId) => {
  let data;
  try {
    data = await fetchAllRows({
      db,
      table: "properties",
      select: PROPERTY_SELECT,
      organizationId,
      orderBy: "id",
      ascending: true,
    });
  } catch (error) {
    throw new Error(`db_properties_read_error:${error.message}`);
  }

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

const buildContactPatchFromRow = (row, existing) => {
  const patch = {};
  const nextName = txt(row.full_name);
  const nextEmail = low(row.email);
  const nextPhone = txt(row.phone);
  const nextNationality = normalizeNationality(row.nationality);
  if (nextName && nextName !== txt(existing.full_name)) patch.full_name = nextName;
  if (nextEmail && !txt(existing.email)) patch.email = nextEmail;
  if (nextPhone && !txt(existing.phone)) patch.phone = nextPhone;
  if (nextNationality && !txt(existing.country_code)) patch.country_code = nextNationality;
  return patch;
};

const syncContactFromRow = async ({ db, organizationId, row, contact, dryRun, stats, contactsIndex }) => {
  if (!contact) return contact;
  const patch = buildContactPatchFromRow(row, contact);
  if (Object.keys(patch).length === 0) return contact;

  let updated = contact;
  if (!dryRun) {
    const { data, error } = await db
      .schema("crm")
      .from("contacts")
      .update(patch)
      .eq("organization_id", organizationId)
      .eq("id", contact.id)
      .select(CONTACT_SELECT)
      .single();
    if (error) throw new Error(`db_contact_update_error:${error.message}`);
    updated = data;
  } else {
    updated = { ...contact, ...patch };
  }

  stats.contacts_updated += 1;
  addContactToIndex(contactsIndex, updated);
  return updated;
};

const ensureContact = async ({ db, organizationId, row, dryRun, updateExisting, stats, contactsIndex }) => {
  const email = low(row.email);
  const phone = normalizePhone(row.phone);
  let existing = null;
  if (email) existing = contactsIndex.byEmail.get(email) ?? null;
  if (!existing && phone) existing = contactsIndex.byPhone.get(phone) ?? null;

  if (existing) {
    if (updateExisting) {
      existing = await syncContactFromRow({
        db,
        organizationId,
        row,
        contact: existing,
        dryRun,
        stats,
        contactsIndex,
      });
    }
    return existing;
  }

  const payload = {
    organization_id: organizationId,
    contact_type: "lead",
    full_name: txt(row.full_name) ?? txt(row.email) ?? txt(row.phone) ?? `Lead row ${row.source_row_number}`,
    email: low(row.email),
    phone: txt(row.phone),
    country_code: normalizeNationality(row.nationality),
    notes: txt(row.message),
  };

  let created;
  if (dryRun) {
    created = { id: `dry_contact_${crypto.randomUUID()}`, ...payload };
  } else {
    const { data, error } = await db.schema("crm").from("contacts").insert(payload).select(CONTACT_SELECT).single();
    if (error) throw new Error(`db_contact_insert_error:${error.message}`);
    created = data;
  }
  stats.contacts_created += 1;
  addContactToIndex(contactsIndex, created);
  return created;
};

const parseSourceRows = ({ source }) => {
  const sourcePath = path.isAbsolute(source.file) ? source.file : path.join(ROOT, source.file);
  if (!fs.existsSync(sourcePath)) throw new Error(`source_file_not_found:${sourcePath}`);

  const raw = fs.readFileSync(sourcePath, "utf8");
  const delimiter = txt(source.delimiter) ?? detectDelimiter(raw);
  const parsed = parseDelimited(raw, delimiter);
  const headerIndex =
    Number.isInteger(source.header_row) && source.header_row > 0 ? source.header_row - 1 : detectHeaderIndex(parsed);
  const lookup = buildLookup(parsed[headerIndex] ?? []);
  const sourceColumns = source.columns && typeof source.columns === "object" ? source.columns : {};

  const rows = [];
  for (let i = headerIndex + 1; i < parsed.length; i += 1) {
    const current = lookup.headers.map((_, idx) => txt(parsed[i]?.[idx]) ?? "");
    const primaryChannelRaw = pickValue(current, lookup, PRIMARY_CHANNEL_ALIASES);
    const fallbackChannelRaw = pickValue(current, lookup, FALLBACK_CHANNEL_ALIASES);
    const configuredSourceRaw = pickValue(current, lookup, toAliasList(sourceColumns?.source));
    const configuredOriginRaw = pickValue(current, lookup, toAliasList(sourceColumns?.origin_type));
    const firstName =
      pickValue(current, lookup, resolveAliases(sourceColumns, "full_name")) ??
      pickValue(current, lookup, ["nombre", "name", "first name"]);
    const lastName = pickValue(current, lookup, ["apellidos", "apellido", "last name", "surname"]);
    const combinedName = txt([firstName, lastName].filter(Boolean).join(" "));
    const mapped = {
      source_row_number: i + 1,
      full_name: combinedName,
      email: firstEmail(pickValue(current, lookup, resolveAliases(sourceColumns, "email"))),
      phone: txt(pickValue(current, lookup, resolveAliases(sourceColumns, "phone"))),
      nationality: normalizeNationality(pickValue(current, lookup, resolveAliases(sourceColumns, "nationality"))),
      tax_id: normalizeTaxId(pickValue(current, lookup, resolveAliases(sourceColumns, "tax_id"))),
      status_raw: pickValue(current, lookup, resolveAliases(sourceColumns, "status")),
      lead_kind_raw: pickValue(current, lookup, resolveAliases(sourceColumns, "lead_kind")),
      channel_raw: primaryChannelRaw ?? configuredSourceRaw ?? configuredOriginRaw ?? fallbackChannelRaw,
      origin_type_raw: configuredOriginRaw ?? fallbackChannelRaw,
      source_raw: configuredSourceRaw ?? primaryChannelRaw ?? fallbackChannelRaw,
      operation_interest_raw: pickValue(current, lookup, resolveAliases(sourceColumns, "operation_interest")),
      property_legacy_code: pickValue(current, lookup, resolveAliases(sourceColumns, "property_legacy_code")),
      message: pickValue(current, lookup, resolveAliases(sourceColumns, "message")),
      discarded_reason: pickValue(current, lookup, resolveAliases(sourceColumns, "discarded_reason")),
      discarded_date: parseDate(pickValue(current, lookup, ["fecha baja", "discarded_at", "drop date"])),
      agency_id: txt(pickValue(current, lookup, resolveAliases(sourceColumns, "agency_id"))),
      provider_id: txt(pickValue(current, lookup, resolveAliases(sourceColumns, "provider_id"))),
      raw_row: buildRawRow(lookup.headers, current),
    };
    const hasIdentity = Boolean(mapped.tax_id || mapped.email || normalizePhone(mapped.phone));
    const hasContent = hasIdentity || txt(mapped.full_name) || txt(mapped.message);
    if (!hasContent) continue;
    rows.push(mapped);
  }

  return {
    source_path: sourcePath,
    source_file_name: path.basename(sourcePath),
    header_row: headerIndex + 1,
    delimiter,
    rows,
  };
};

const findClientMatch = (clientsIndex, row) => {
  const taxId = normalizeTaxId(row.tax_id);
  const email = low(row.email);
  const phone = normalizePhone(row.phone);
  if (taxId && clientsIndex.byTax.has(taxId)) return clientsIndex.byTax.get(taxId);
  if (email && clientsIndex.byEmail.has(email)) return clientsIndex.byEmail.get(email);
  if (phone && clientsIndex.byPhone.has(phone)) return clientsIndex.byPhone.get(phone);
  return null;
};

const findLeadMatch = (leadsIndex, row, sourceMeta) => {
  const importKey = rowImportKey(row, sourceMeta);
  if (importKey && leadsIndex.byImport.has(importKey)) return leadsIndex.byImport.get(importKey);
  const taxId = normalizeTaxId(row.tax_id);
  const email = low(row.email);
  const phone = normalizePhone(row.phone);
  if (taxId && leadsIndex.byTax.has(taxId)) return leadsIndex.byTax.get(taxId);
  if (email && leadsIndex.byEmail.has(email)) return leadsIndex.byEmail.get(email);
  if (phone && leadsIndex.byPhone.has(phone)) return leadsIndex.byPhone.get(phone);
  return null;
};

const isBajaClientStatus = (status) => {
  const normalized = txt(status);
  return normalized === "inactive" || normalized === "discarded" || normalized === "blacklisted";
};

const buildLeadPayload = ({
  row,
  organizationId,
  contactId,
  propertyContext,
  channelContext,
  sourceMeta,
  sourceCatalog,
  defaults,
}) => {
  const leadStatus = normalizeLeadStatus(row.status_raw ?? defaults.status, normalizeLeadStatus(defaults.status, "new"));
  const leadKind = normalizeLeadKind(row.lead_kind_raw ?? defaults.lead_kind, normalizeLeadKind(defaults.lead_kind, "buyer"));
  const originInput = channelContext.origin_type ?? row.origin_type_raw ?? row.source_raw ?? defaults.origin_type;
  let originType = normalizeOriginType(
    originInput,
    normalizeOriginType(defaults.origin_type, "other")
  );
  const operationInterest = normalizeOperationInterest(
    row.operation_interest_raw ?? defaults.operation_interest,
    normalizeOperationInterest(defaults.operation_interest, "sale")
  );
  const agencyId = isUuid(row.agency_id ?? defaults.agency_id) ? txt(row.agency_id ?? defaults.agency_id) : null;
  const providerId = isUuid(row.provider_id ?? defaults.provider_id) ? txt(row.provider_id ?? defaults.provider_id) : null;
  if (originType === "agency" && !agencyId) originType = "other";
  if (originType === "provider" && !providerId) originType = "other";

  const source = channelContext.channel_detail ?? normalizeSourceKey(txt(defaults.source), null) ?? "csv_import";
  const discardedDate = row.discarded_date ? `${row.discarded_date}T00:00:00Z` : null;
  const status = leadStatus === "converted" ? "in_process" : leadStatus;

  return {
    organization_id: organizationId,
    contact_id: contactId,
    property_id: propertyContext.property_id,
    agency_id: agencyId,
    provider_id: providerId,
    lead_kind: leadKind,
    origin_type: originType,
    source,
    status,
    operation_interest: operationInterest,
    discarded_reason:
      status === "discarded"
        ? txt(row.discarded_reason) ?? txt(row.status_raw) ?? txt(defaults.discarded_reason) ?? "imported_discarded"
        : null,
    discarded_at: status === "discarded" ? discardedDate : null,
    raw_payload: {
      tax_id: normalizeTaxId(row.tax_id),
      nationality: normalizeNationality(row.nationality),
      import: {
        source_file: sourceMeta.source_file_name,
        source_path: sourceMeta.source_rel_path,
        source_row_number: row.source_row_number,
        imported_at: new Date().toISOString(),
        source_catalog: sourceCatalog.relative_path,
      },
      channel: {
        raw_value: txt(channelContext.raw_value),
        channel_detail: channelContext.channel_detail,
        source_label: channelContext.source_label,
        origin_type: originType,
        catalog_origin_type: channelContext.origin_type,
        decision_status: channelContext.decision_status,
        notes: channelContext.notes,
        matched_from_catalog: channelContext.matched_from_catalog,
      },
      project: {
        property_id: propertyContext.property_id,
        property_legacy_code: propertyContext.property_legacy_code,
        property_record_type: propertyContext.property_record_type,
        project_id: propertyContext.project_id,
        project_legacy_code: propertyContext.project_legacy_code,
        project_record_type: propertyContext.project_record_type,
        association_source: propertyContext.association_source,
        requested_legacy_code: propertyContext.requested_legacy_code,
        requested_row_legacy_code: propertyContext.requested_row_legacy_code,
        default_property_legacy_code: propertyContext.default_property_legacy_code,
      },
      mapped: {
        full_name: txt(row.full_name),
        email: low(row.email),
        phone: txt(row.phone),
        nationality: normalizeNationality(row.nationality),
        tax_id: normalizeTaxId(row.tax_id),
        channel_raw: txt(channelContext.raw_value),
        channel_detail: channelContext.channel_detail,
        source_label: channelContext.source_label,
        status_raw: txt(row.status_raw),
        lead_kind_raw: txt(row.lead_kind_raw),
        origin_type_raw: txt(row.origin_type_raw),
        source_raw: txt(row.source_raw),
        operation_interest_raw: txt(row.operation_interest_raw),
        property_legacy_code: propertyContext.property_legacy_code ?? txt(row.property_legacy_code),
        property_id: propertyContext.property_id,
        project_legacy_code: propertyContext.project_legacy_code,
        project_id: propertyContext.project_id,
        message: txt(row.message),
        discarded_reason: txt(row.discarded_reason),
      },
      raw_row: row.raw_row,
    },
  };
};

const run = async () => {
  if (flag("help")) {
    help();
    return;
  }

  const jobFile = arg("job-file");
  if (!jobFile) throw new Error("job_file_required (--job-file)");
  const { absolutePath: jobPath, payload: job } = readJob(jobFile);

  const organizationId =
    txt(arg("organization-id")) ??
    txt(env("CRM_ORGANIZATION_ID")) ??
    txt(env("PUBLIC_CRM_ORGANIZATION_ID")) ??
    txt(job.organization_id);
  if (!organizationId || !UUID_RX.test(organizationId)) {
    throw new Error("organization_id_required_uuid");
  }

  const sources = Array.isArray(job.sources) ? job.sources : [];
  if (!sources.length) throw new Error("sources_required");

  const dryRun = flag("dry-run");
  const updateExisting = flag("update-existing");
  const continueOnError = flag("continue-on-error");
  const limitValue = Number(arg("limit"));
  const limit = Number.isFinite(limitValue) && limitValue > 0 ? Math.floor(limitValue) : null;

  const globalDefaults = job.defaults && typeof job.defaults === "object" ? job.defaults : {};
  const skipStatusTokens = [
    ...DEFAULT_SKIP_STATUS_TOKENS,
    ...toArray(globalDefaults.skip_status_tokens).map((value) => String(value ?? "")),
  ].filter((value) => canonical(value));

  const supabaseUrl = env("SUPABASE_URL") ?? env("PUBLIC_SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("missing_supabase_credentials");

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const sourceCatalog = loadLeadSourceCatalog(job.source_catalog_file);
  const contactsIndex = await loadContactsIndex(db, organizationId);
  const clientsIndex = await loadClientsIndex(db, organizationId, contactsIndex);
  const leadsIndex = await loadLeadsIndex(db, organizationId, contactsIndex);
  const propertiesIndex = await loadPropertiesIndex(db, organizationId);

  const stats = {
    dry_run: dryRun,
    update_existing: updateExisting,
    continue_on_error: continueOnError,
    organization_id: organizationId,
    sources_total: sources.length,
    rows_read: 0,
    rows_processed: 0,
    leads_created: 0,
    leads_updated: 0,
    leads_skipped_existing: 0,
    skipped_missing_identity: 0,
    skipped_csv_client_or_baja: 0,
    skipped_existing_client_active: 0,
    skipped_existing_client_baja: 0,
    skipped_existing_lead_converted: 0,
    contacts_created: 0,
    contacts_updated: 0,
    unresolved_property_codes: 0,
    source_catalog_entries: sourceCatalog.entries_total,
    source_catalog_path: sourceCatalog.relative_path,
    errors: 0,
  };

  const sourceReports = [];
  const failures = [];
  const skips = [];
  const unresolvedCodes = new Set();
  const channelSummary = new Map();
  const originSummary = new Map();
  const unresolvedChannelValues = new Map();
  const pendingBusinessChannels = new Map();
  const projectAssociationSummary = {
    with_property: 0,
    with_project: 0,
    without_project: 0,
  };
  let processedRows = 0;

  for (const sourceItem of sources) {
    const source = sourceItem && typeof sourceItem === "object" ? sourceItem : {};
    const parsed = parseSourceRows({ source });
    const sourceDefaults =
      source.defaults && typeof source.defaults === "object" ? { ...globalDefaults, ...source.defaults } : { ...globalDefaults };
    const sourceSkipTokens = [
      ...skipStatusTokens,
      ...toArray(sourceDefaults.skip_status_tokens).map((value) => String(value ?? "")),
    ].filter((value) => canonical(value));

    const sourceMeta = {
      source_file_name: parsed.source_file_name,
      source_rel_path: path.relative(ROOT, parsed.source_path),
      header_row: parsed.header_row,
      delimiter: parsed.delimiter,
      rows: parsed.rows.length,
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    };

    for (const row of parsed.rows) {
      if (limit && processedRows >= limit) break;
      stats.rows_read += 1;
      processedRows += 1;

      try {
        const taxId = normalizeTaxId(row.tax_id);
        const email = low(row.email);
        const phone = normalizePhone(row.phone);
        const hasIdentity = Boolean(taxId || email || phone);
        if (!hasIdentity) {
          stats.skipped_missing_identity += 1;
          sourceMeta.skipped += 1;
          skips.push({
            file: sourceMeta.source_file_name,
            row: row.source_row_number,
            reason: "missing_identity",
          });
          continue;
        }

        if (shouldSkipByCsvStatus(row.status_raw, sourceSkipTokens)) {
          stats.skipped_csv_client_or_baja += 1;
          sourceMeta.skipped += 1;
          skips.push({
            file: sourceMeta.source_file_name,
            row: row.source_row_number,
            reason: "csv_status_client_or_baja",
            status_raw: txt(row.status_raw),
          });
          continue;
        }

        const clientMatch = findClientMatch(clientsIndex, row);
        if (clientMatch) {
          if (isBajaClientStatus(clientMatch.client_status)) stats.skipped_existing_client_baja += 1;
          else stats.skipped_existing_client_active += 1;
          sourceMeta.skipped += 1;
          skips.push({
            file: sourceMeta.source_file_name,
            row: row.source_row_number,
            reason: isBajaClientStatus(clientMatch.client_status) ? "existing_client_baja" : "existing_client_active",
            client_id: txt(clientMatch.id),
            client_status: txt(clientMatch.client_status),
          });
          continue;
        }

        const rowPropertyCode = txt(row.property_legacy_code);
        const defaultPropertyCode = txt(sourceDefaults.property_legacy_code);
        const propertyContext = resolvePropertyContext({
          propertiesIndex,
          rowPropertyCode,
          defaultPropertyCode,
        });

        if (!propertyContext.property_id && (rowPropertyCode || defaultPropertyCode)) {
          if (rowPropertyCode) unresolvedCodes.add(rowPropertyCode);
          if (defaultPropertyCode) unresolvedCodes.add(defaultPropertyCode);
          stats.unresolved_property_codes += 1;
        }
        let existingLead = findLeadMatch(leadsIndex, row, sourceMeta);

        if (existingLead && txt(existingLead.status) === "converted") {
          stats.skipped_existing_lead_converted += 1;
          sourceMeta.skipped += 1;
          skips.push({
            file: sourceMeta.source_file_name,
            row: row.source_row_number,
            reason: "existing_lead_converted",
            lead_id: txt(existingLead.id),
          });
          continue;
        }

        if (existingLead && !updateExisting) {
          stats.leads_skipped_existing += 1;
          sourceMeta.skipped += 1;
          skips.push({
            file: sourceMeta.source_file_name,
            row: row.source_row_number,
            reason: "existing_lead",
            lead_id: txt(existingLead.id),
          });
          continue;
        }

        let contact =
          existingLead && txt(existingLead.contact_id)
            ? contactsIndex.byId.get(String(existingLead.contact_id)) ?? null
            : null;
        const contactFromExistingLead = Boolean(contact);

        if (!contact) {
          contact = await ensureContact({
            db,
            organizationId,
            row,
            dryRun,
            updateExisting,
            stats,
            contactsIndex,
          });
        } else if (updateExisting && contactFromExistingLead) {
          contact = await syncContactFromRow({
            db,
            organizationId,
            row,
            contact,
            dryRun,
            stats,
            contactsIndex,
          });
        }

        const channelContext = resolveLeadChannel({
          row,
          defaults: sourceDefaults,
          sourceMeta,
          sourceCatalog,
        });

        const payload = buildLeadPayload({
          row,
          organizationId,
          contactId: String(contact.id),
          propertyContext,
          channelContext,
          sourceMeta,
          sourceCatalog,
          defaults: sourceDefaults,
        });

        if (existingLead) {
          const updatePayload = { ...payload };
          delete updatePayload.organization_id;
          if (!dryRun) {
            const { data, error } = await db
              .schema("crm")
              .from("leads")
              .update(updatePayload)
              .eq("organization_id", organizationId)
              .eq("id", existingLead.id)
              .select(LEAD_SELECT)
              .single();
            if (error) throw new Error(`db_lead_update_error:${error.message}`);
            existingLead = data;
          } else {
            existingLead = { ...existingLead, ...updatePayload };
          }

          stats.leads_updated += 1;
          stats.rows_processed += 1;
          sourceMeta.updated += 1;
          sourceMeta.processed += 1;
          bumpCounter(channelSummary, channelContext.channel_detail);
          bumpCounter(originSummary, payload.origin_type);
          if (txt(channelContext.raw_value) && !channelContext.matched_from_catalog) {
            bumpCounter(unresolvedChannelValues, channelContext.raw_value);
          }
          if (channelContext.decision_status === "pending_business" && txt(channelContext.raw_value)) {
            bumpCounter(pendingBusinessChannels, channelContext.raw_value);
          }
          if (propertyContext.property_id) projectAssociationSummary.with_property += 1;
          if (propertyContext.project_id) projectAssociationSummary.with_project += 1;
          else projectAssociationSummary.without_project += 1;
          indexLeadIdentity(leadsIndex, existingLead, contact, taxId, row, sourceMeta);
          continue;
        }

        let createdLead;
        if (!dryRun) {
          const { data, error } = await db.schema("crm").from("leads").insert(payload).select(LEAD_SELECT).single();
          if (error) throw new Error(`db_lead_insert_error:${error.message}`);
          createdLead = data;
        } else {
          createdLead = { id: `dry_lead_${crypto.randomUUID()}`, ...payload };
        }

        stats.leads_created += 1;
        stats.rows_processed += 1;
        sourceMeta.created += 1;
        sourceMeta.processed += 1;
        bumpCounter(channelSummary, channelContext.channel_detail);
        bumpCounter(originSummary, payload.origin_type);
        if (txt(channelContext.raw_value) && !channelContext.matched_from_catalog) {
          bumpCounter(unresolvedChannelValues, channelContext.raw_value);
        }
        if (channelContext.decision_status === "pending_business" && txt(channelContext.raw_value)) {
          bumpCounter(pendingBusinessChannels, channelContext.raw_value);
        }
        if (propertyContext.property_id) projectAssociationSummary.with_property += 1;
        if (propertyContext.project_id) projectAssociationSummary.with_project += 1;
        else projectAssociationSummary.without_project += 1;
        indexLeadIdentity(leadsIndex, createdLead, contact, taxId, row, sourceMeta);
      } catch (error) {
        stats.errors += 1;
        sourceMeta.errors += 1;
        failures.push({
          file: sourceMeta.source_file_name,
          row: row.source_row_number,
          message: error instanceof Error ? error.message : String(error),
        });
        if (!continueOnError) throw error;
      }
    }

    sourceReports.push(sourceMeta);
    if (limit && processedRows >= limit) break;
  }

  const report = {
    ok: failures.length === 0,
    generated_at: new Date().toISOString(),
    job_file: path.relative(ROOT, jobPath),
    organization_id: organizationId,
    stats,
    sources: sourceReports,
    unresolved_property_codes: Array.from(unresolvedCodes).slice(0, 200),
    analytics: {
      by_channel_detail: sortedCounterEntries(channelSummary, "channel_detail").slice(0, 200),
      by_origin_type: sortedCounterEntries(originSummary, "origin_type").slice(0, 50),
      unresolved_channel_values: sortedCounterEntries(unresolvedChannelValues, "raw_value").slice(0, 200),
      pending_business_channels: sortedCounterEntries(pendingBusinessChannels, "raw_value").slice(0, 200),
      project_association: projectAssociationSummary,
    },
    skips_preview: skips.slice(0, 200),
    skips_omitted: Math.max(0, skips.length - 200),
    failures_preview: failures.slice(0, 200),
    failures_omitted: Math.max(0, failures.length - 200),
  };

  const reportsDir = path.join(ROOT, "scripts", "lead-import", "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(reportsDir, `leads-import-${stamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: failures.length === 0 || continueOnError,
        report_path: reportPath,
        stats,
      },
      null,
      2
    )
  );

  if (failures.length && !continueOnError) {
    throw new Error(`import_finished_with_errors:${failures.length}`);
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
