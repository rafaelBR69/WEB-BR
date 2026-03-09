import fs from "node:fs";
import path from "node:path";

export const ROOT = process.cwd();

export const DEFAULT_AGENCY_ALIASES = {
  intake_date: ["FECHA ENTRADA", "FECHA", "c"],
  source_channel: ["ORIGEN", "FUENTE"],
  relationship_stage: ["ESTADO", "SITUACION", "EN ESPERA/COLABORAMOS"],
  agency_name: ["NOMBRE AGENCIA", "NOMBRE COMERCIAL AGENCIA", "AGENCIA"],
  agent_name: ["NOMBRE AGENTE", "PERSONA DE CONTACTO", "PERSONA CONTACTO", "NOMBRE"],
  phone: ["TLF", "TELEFONO", "TELEFONO "],
  email: ["EMAIL", "MAIL"],
  country: ["NACIONALIDAD", "PAIS", "PAÍS", "LOCALIZACION"],
  managed_by: ["GESTIONADO POR"],
  commercial_comment: ["COMENTARIO COMERCIAL", "COMENTARIO", "COMENTARIOS"],
  agency_kit_sent: ["ENVIADO AGENCY KIT", "AGENCY KIT ENVIADO"],
  contract_sent: ["CONTRATO ENVIADO"],
  legal_name: ["RAZÓN SOCIAL", "RAZÃ“N SOCIAL"],
  tax_id: ["CIF/NIF/PASAPORTE", "CIF/NIF", "CIF/NIF/NIE", "CIF/NIF/PASAPORTE/DNI"],
  representative_name: ["NOMBRE Y APELLIDOS REPRESENTANTE/ ADMIN", "NOMBRE Y APELLIDOSREPRESENTANTE/ ADMIN"],
  representative_nie: ["NIE", "DNI"],
  role_label: ["ROL"],
  docs_complete: ["APORTADA  DOC. COMPLETA"],
  signed_by_agency: ["FIRMADO AGENCIA", "FIRMADO POR AGENCIA"],
  signed_by_xavier: ["FIRMADO XAVIER", "FIRMADO POR XAVIER"],
  signed_date: ["FECHA"],
  collaboration_pct: ["% COLABORACIÓN FIRMADO", "% COLABORACIÃ“N FIRMADO"],
  resent_to_agency: ["DEVUELTO AGENCIA", "ENVIADO A LA AGENCIA DE NUEVO", "FECHA DE ENVIO A LA AGENCIA DE NUEVO"],
  legal_comment: ["COMENTARIO LEGAL"],
  uploaded_drive: ["SUBIDO A DRIVE"],
  uploaded_mobilia: ["SUBIDO A MOBILIA", "SUBIDO MOBILIA"],
};

export const DEFAULT_LEAD_ALIASES = {
  intake_date: ["FECHA DE ENTRADA", "FECHA ENTRADA", "FECHA"],
  channel: ["CANAL DE ENTRADA", "FUENTE", "ORIGEN"],
  status: ["ESTADO"],
  lead_type: ["TIPO Cliente ", "TIPO", "TIPO CLIENTE", "TIPO DE LEAD"],
  agency_name: ["NOMBRE AGENCIA", "Nombre comercial agencia", "AGENCIA"],
  agent_name: ["AGENTE AGENCIA"],
  lead_name: ["NOMBRE"],
  lead_surname: ["APELLIDOS"],
  phone: ["TLF", " TLF", "TELEFONO"],
  email: ["EMAIL", "MAIL"],
  nationality: ["NACIONALIDAD"],
  comments: [
    "COMENTARIOS",
    "CLIENT ENQUIRIES",
    "COMENTARIOS/ACCIONES CON FECHA",
    "REPORTE",
    "REPORTE 1",
    "REPORTE 2",
    "REPORTE 3",
    "DESCARTADO POR",
    "OTROS",
  ],
};

export const parseEnvFile = (filePath) => {
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
    out[key] = value;
  }
  return out;
};

export const arg = (name) => {
  const inlinePrefix = `--${name}=`;
  const inline = process.argv.find((part) => part.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};

export const flag = (name) => process.argv.includes(`--${name}`);

export const txt = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

export const canonical = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.]+/g, " ")
    .trim();

export const normalizeEmail = (value) => {
  const text = txt(value);
  if (!text) return null;
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
};

export const normalizePhone = (value) => {
  const text = txt(value);
  if (!text) return null;
  const digits = text.replace(/\D+/g, "");
  return digits.length >= 6 ? digits : null;
};

export const normalizeTaxId = (value) => {
  const text = txt(value);
  if (!text) return null;
  return text.toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "");
};

export const normalizePercent = (value) => {
  const text = txt(value);
  if (!text) return null;
  const cleaned = text.replace("%", "").replace(",", ".").replace(/[^\d.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

export const parseBool = (value) => {
  const normalized = canonical(value);
  if (!normalized) return null;
  if (["true", "si", "yes", "1", "x", "ok", "enviado", "firmado", "colaboramos", "completada"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "0", "pendiente"].includes(normalized)) return false;
  return null;
};

export const parseDateLoose = (value) => {
  const text = txt(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

export const normalizeProjectSlug = (value) => canonical(value).replace(/\s+/g, " ").trim();

export const scoreCompleteness = (record) => {
  const keys = [
    "agency_name",
    "agent_name",
    "email",
    "phone",
    "legal_name",
    "tax_id",
    "representative_name",
    "representative_nie",
    "commercial_comment",
    "legal_comment",
  ];
  return keys.reduce((sum, key) => sum + (txt(record[key]) ? 1 : 0), 0);
};

export const dedupeKeyParts = (record) => {
  const agencyName = canonical(record.agency_name);
  const agentName = canonical(record.agent_name);
  const email = record.email ?? null;
  const phone = record.phone ?? null;
  const taxId = record.tax_id ?? null;
  const legalName = canonical(record.legal_name);

  if (taxId) return { type: "tax_id", key: `tax_id:${taxId}` };
  if (agencyName && email) return { type: "agency_email", key: `agency_email:${agencyName}|${email}` };
  if (agencyName && phone) return { type: "agency_phone", key: `agency_phone:${agencyName}|${phone}` };
  if (legalName && email) return { type: "legal_email", key: `legal_email:${legalName}|${email}` };
  if (email && agentName) return { type: "agent_email", key: `agent_email:${agentName}|${email}` };
  if (phone && agentName) return { type: "agent_phone", key: `agent_phone:${agentName}|${phone}` };
  if (email) return { type: "email_only", key: `email_only:${email}` };
  if (phone) return { type: "phone_only", key: `phone_only:${phone}` };
  if (agencyName && agentName) return { type: "agency_agent", key: `agency_agent:${agencyName}|${agentName}` };
  if (agencyName) return { type: "agency_only", key: `agency_only:${agencyName}` };
  return { type: "source_row", key: `source_row:${record.source_file}|${record.source_row_number}` };
};

export const normalizeRelationshipStage = (value) => {
  const normalized = canonical(value);
  if (!normalized) return "unknown";
  if (
    normalized.includes("colaboramos") ||
    normalized.includes("colaboracion completada") ||
    normalized.includes("completada")
  ) {
    return "active";
  }
  if (
    normalized.includes("agency kit enviado") ||
    normalized.includes("informacion enviada") ||
    normalized.includes("info enviada") ||
    normalized.includes("en espera") ||
    normalized.includes("espera")
  ) {
    return "pending";
  }
  if (normalized.includes("descart")) return "discarded";
  return "other";
};

export const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

export const ensureDir = (dirPath) => fs.mkdirSync(dirPath, { recursive: true });

export const timestamp = () => new Date().toISOString().replace(/[:.]/g, "-");

export const decodeTextFile = (filePath) => {
  const buffer = fs.readFileSync(filePath);
  const decoders = [
    { label: "utf-8-sig", decoder: new TextDecoder("utf-8", { fatal: true }) },
    { label: "windows-1252", decoder: new TextDecoder("windows-1252") },
    { label: "latin1", decoder: new TextDecoder("iso-8859-1") },
  ];

  for (const entry of decoders) {
    try {
      const text = entry.decoder.decode(buffer).replace(/^\uFEFF/, "");
      return { encoding: entry.label, text };
    } catch {
      // try next
    }
  }

  return { encoding: "utf-8-lossy", text: buffer.toString("utf8").replace(/^\uFEFF/, "") };
};

export const detectDelimiter = (rawText) => {
  const lines = String(rawText ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
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

export const parseDelimited = (rawText, delimiter) => {
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

export const detectHeaderIndex = (rows) => {
  let bestIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
    const sample = rows[i].map((value) => txt(value)).filter(Boolean);
    if (!sample.length) continue;
    const line = canonical(sample.join(" "));
    const score =
      sample.length +
      (line.includes("nombre") ? 3 : 0) +
      (line.includes("agencia") ? 3 : 0) +
      (line.includes("email") || line.includes("mail") ? 3 : 0) +
      (line.includes("telefono") || line.includes("tlf") ? 3 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
};

export const cleanHeader = (value, index) =>
  String(value ?? `column_${index + 1}`)
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const readCsvTable = (filePath, headerRow = null) => {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`csv_not_found:${absolutePath}`);
  const { encoding, text } = decodeTextFile(absolutePath);
  const delimiter = detectDelimiter(text);
  const rows = parseDelimited(text, delimiter);
  const headerIndex = Number.isInteger(headerRow) && headerRow > 0 ? headerRow - 1 : detectHeaderIndex(rows);
  const headers = (rows[headerIndex] ?? []).map((value, index) => cleanHeader(value, index));
  const entries = [];

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const current = rows[i] ?? [];
    const record = {};
    let hasAnyValue = false;
    headers.forEach((header, index) => {
      const value = txt(current[index]) ?? null;
      if (value) hasAnyValue = true;
      record[header] = value;
    });
    if (!hasAnyValue) continue;
    entries.push({
      source_row_number: i + 1,
      raw: record,
    });
  }

  return {
    absolutePath,
    encoding,
    delimiter,
    header_index: headerIndex + 1,
    headers,
    rows: entries,
  };
};

export const pickValue = (rawRow, aliases = []) => {
  const keys = new Map();
  Object.keys(rawRow).forEach((key) => {
    keys.set(canonical(key), key);
  });

  for (const alias of aliases) {
    const targetKey = keys.get(canonical(alias));
    if (!targetKey) continue;
    const value = txt(rawRow[targetKey]);
    if (value) return value;
  }
  return null;
};

export const csvEscape = (value) => {
  const text = String(value ?? "");
  if (!text.includes(",") && !text.includes('"') && !text.includes("\n") && !text.includes("\r")) return text;
  return `"${text.replace(/"/g, '""')}"`;
};

export const isAgencyPlaceholder = (value) => {
  const normalized = canonical(value);
  if (!normalized) return true;
  return ["sin agencia", "no agencia", "ninguna agencia", "n a", "na"].includes(normalized);
};

export const isAgencyAgentPlaceholder = (value) => {
  const normalized = canonical(value);
  if (!normalized) return true;
  return ["sin agente", "no agente", "ningun agente", "ningún agente", "n a", "na"].includes(normalized);
};

export const writeCsv = (filePath, rows, headers) => {
  const lines = [headers.map(csvEscape).join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((header) => csvEscape(row[header] ?? "")).join(","));
  });
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
};

export const writeJson = (filePath, value) => {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

export const relativeFromRoot = (filePath) => path.relative(ROOT, filePath).replace(/\\/g, "/");

export const mergeUniqueText = (...values) => {
  const bucket = [];
  const seen = new Set();
  values.flat().forEach((value) => {
    const text = txt(value);
    if (!text) return;
    const key = canonical(text);
    if (seen.has(key)) return;
    seen.add(key);
    bucket.push(text);
  });
  return bucket.join(" | ") || null;
};

export const buildAgencyRecord = (source, row) => {
  const raw = row.raw;
  const sourceDefaults = source.defaults ?? {};
  const intakeDate = parseDateLoose(pickValue(raw, DEFAULT_AGENCY_ALIASES.intake_date) ?? sourceDefaults.intake_date);
  const sourceChannel = pickValue(raw, DEFAULT_AGENCY_ALIASES.source_channel) ?? txt(sourceDefaults.source_channel);
  const relationshipStageRaw =
    pickValue(raw, DEFAULT_AGENCY_ALIASES.relationship_stage) ?? txt(sourceDefaults.relationship_stage);
  const agencyName = pickValue(raw, DEFAULT_AGENCY_ALIASES.agency_name);
  const agentName = pickValue(raw, DEFAULT_AGENCY_ALIASES.agent_name);
  const commercialComment = pickValue(raw, DEFAULT_AGENCY_ALIASES.commercial_comment);
  const legalComment = pickValue(raw, DEFAULT_AGENCY_ALIASES.legal_comment);
  const record = {
    project_label: txt(source.project_label),
    project_legacy_code: txt(source.project_legacy_code),
    source_file: relativeFromRoot(source.absolutePath),
    source_row_number: row.source_row_number,
    intake_date: intakeDate,
    source_channel: sourceChannel,
    relationship_stage_raw: relationshipStageRaw,
    relationship_stage: normalizeRelationshipStage(relationshipStageRaw),
    agency_name: agencyName,
    agent_name: agentName,
    email: normalizeEmail(pickValue(raw, DEFAULT_AGENCY_ALIASES.email)),
    phone: normalizePhone(pickValue(raw, DEFAULT_AGENCY_ALIASES.phone)),
    country: pickValue(raw, DEFAULT_AGENCY_ALIASES.country),
    managed_by: pickValue(raw, DEFAULT_AGENCY_ALIASES.managed_by),
    commercial_comment: commercialComment,
    agency_kit_sent: parseBool(pickValue(raw, DEFAULT_AGENCY_ALIASES.agency_kit_sent)),
    contract_sent: parseBool(pickValue(raw, DEFAULT_AGENCY_ALIASES.contract_sent)),
    legal_name: pickValue(raw, DEFAULT_AGENCY_ALIASES.legal_name),
    tax_id: normalizeTaxId(pickValue(raw, DEFAULT_AGENCY_ALIASES.tax_id)),
    representative_name: pickValue(raw, DEFAULT_AGENCY_ALIASES.representative_name),
    representative_nie: normalizeTaxId(pickValue(raw, DEFAULT_AGENCY_ALIASES.representative_nie)),
    role_label: pickValue(raw, DEFAULT_AGENCY_ALIASES.role_label),
    docs_complete: parseBool(pickValue(raw, DEFAULT_AGENCY_ALIASES.docs_complete)),
    signed_by_agency: parseBool(pickValue(raw, DEFAULT_AGENCY_ALIASES.signed_by_agency)),
    signed_by_xavier: parseBool(pickValue(raw, DEFAULT_AGENCY_ALIASES.signed_by_xavier)),
    signed_date: parseDateLoose(pickValue(raw, DEFAULT_AGENCY_ALIASES.signed_date)),
    collaboration_pct: normalizePercent(pickValue(raw, DEFAULT_AGENCY_ALIASES.collaboration_pct)),
    resent_to_agency: txt(pickValue(raw, DEFAULT_AGENCY_ALIASES.resent_to_agency)),
    legal_comment: legalComment,
    uploaded_drive: parseBool(pickValue(raw, DEFAULT_AGENCY_ALIASES.uploaded_drive)),
    uploaded_mobilia: parseBool(pickValue(raw, DEFAULT_AGENCY_ALIASES.uploaded_mobilia)),
    combined_comments: mergeUniqueText(commercialComment, legalComment),
    raw_json: JSON.stringify(raw),
  };
  const dedupe = dedupeKeyParts(record);
  return {
    ...record,
    dedupe_key_type: dedupe.type,
    dedupe_key: dedupe.key,
    completeness_score: scoreCompleteness(record),
  };
};

export const buildLeadRecord = (source, row) => {
  const raw = row.raw;
  const leadName = mergeUniqueText(pickValue(raw, DEFAULT_LEAD_ALIASES.lead_name), pickValue(raw, DEFAULT_LEAD_ALIASES.lead_surname))
    ?.replace(/\s+\|\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim() ?? null;
  const agencyNameRaw = pickValue(raw, DEFAULT_LEAD_ALIASES.agency_name);
  const agencyAgentRaw = pickValue(raw, DEFAULT_LEAD_ALIASES.agent_name);
  return {
    project_label: txt(source.project_label),
    project_legacy_code: txt(source.project_legacy_code),
    source_file: relativeFromRoot(source.absolutePath),
    source_row_number: row.source_row_number,
    intake_date: parseDateLoose(pickValue(raw, DEFAULT_LEAD_ALIASES.intake_date)),
    channel: pickValue(raw, DEFAULT_LEAD_ALIASES.channel),
    status: pickValue(raw, DEFAULT_LEAD_ALIASES.status),
    lead_type: pickValue(raw, DEFAULT_LEAD_ALIASES.lead_type),
    agency_name: isAgencyPlaceholder(agencyNameRaw) ? null : agencyNameRaw,
    agent_name: isAgencyAgentPlaceholder(agencyAgentRaw) ? null : agencyAgentRaw,
    lead_name: leadName,
    phone: normalizePhone(pickValue(raw, DEFAULT_LEAD_ALIASES.phone)),
    email: normalizeEmail(pickValue(raw, DEFAULT_LEAD_ALIASES.email)),
    nationality: pickValue(raw, DEFAULT_LEAD_ALIASES.nationality),
    comments: pickValue(raw, DEFAULT_LEAD_ALIASES.comments),
    raw_json: JSON.stringify(raw),
  };
};
