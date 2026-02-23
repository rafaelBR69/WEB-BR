import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const parseEnvFile = (file) => {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
};

const envFiles = {
  ...parseEnvFile(path.join(ROOT, ".env")),
  ...parseEnvFile(path.join(ROOT, ".env.local")),
};

const env = (name) => {
  const value = process.env[name] ?? envFiles[name];
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length ? text : null;
};

const arg = (name) => {
  const prefix = `--${name}=`;
  const direct = process.argv.find((entry) => entry.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1] ?? null;
  const npmConfigKey = `npm_config_${name.replaceAll("-", "_")}`;
  const npmConfigValue = process.env[npmConfigKey];
  if (typeof npmConfigValue === "string" && npmConfigValue.trim().length > 0) {
    return npmConfigValue.trim();
  }
  return null;
};

const text = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const asObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};

const toCsvValue = (value) => {
  const raw = value == null ? "" : String(value);
  if (raw.includes('"') || raw.includes(",") || raw.includes("\n") || raw.includes("\r")) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
};

const toCsv = (rows, headers) => {
  const lines = [];
  lines.push(headers.map(toCsvValue).join(","));
  rows.forEach((row) => {
    lines.push(headers.map((header) => toCsvValue(row[header])).join(","));
  });
  return `${lines.join("\n")}\n`;
};

const normalizeNameFromTranslations = (translationsValue, fallback) => {
  const translations = asObject(translationsValue);
  for (const lang of ["es", "en", "de", "fr", "it", "nl"]) {
    const scoped = asObject(translations[lang]);
    const title = text(scoped.title) ?? text(scoped.name);
    if (title) return title;
  }
  return fallback;
};

const fetchAllRows = async ({ db, table, select, organizationId, orderBy }) => {
  const rows = [];
  const pageSize = 1000;
  let from = 0;
  let guard = 0;

  while (guard < 500) {
    guard += 1;
    let query = db
      .schema("crm")
      .from(table)
      .select(select)
      .eq("organization_id", organizationId)
      .range(from, from + pageSize - 1);

    if (orderBy) {
      query = query.order(orderBy, { ascending: true });
    }

    const { data, error } = await query;
    if (error) throw new Error(`db_${table}_read_error:${error.message}`);
    const chunk = Array.isArray(data) ? data : [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return rows;
};

const ensureDir = (absolutePath) => {
  if (!fs.existsSync(absolutePath)) fs.mkdirSync(absolutePath, { recursive: true });
};

const main = async () => {
  const organizationId =
    text(arg("organization-id")) ??
    text(env("CRM_ORGANIZATION_ID")) ??
    text(env("PUBLIC_CRM_ORGANIZATION_ID"));

  if (!organizationId || !UUID_RX.test(organizationId)) {
    throw new Error("organization_id_invalid");
  }

  const supabaseUrl = text(env("SUPABASE_URL")) ?? text(env("PUBLIC_SUPABASE_URL"));
  const supabaseKey =
    text(env("SUPABASE_SERVICE_ROLE_KEY")) ??
    text(env("SUPABASE_ANON_KEY")) ??
    text(env("PUBLIC_SUPABASE_ANON_KEY"));

  if (!supabaseUrl || !supabaseKey) throw new Error("supabase_env_missing");

  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  const propertiesRaw = await fetchAllRows({
    db,
    table: "properties",
    select: [
      "id",
      "legacy_code",
      "record_type",
      "status",
      "parent_property_id",
      "property_data",
      "translations",
      "updated_at",
      "created_at",
    ].join(","),
    organizationId,
    orderBy: "legacy_code",
  });

  const propertyById = new Map();
  propertiesRaw.forEach((row) => {
    const id = text(row.id);
    if (!id) return;
    propertyById.set(id, row);
  });

  const propertiesRows = propertiesRaw.map((row) => {
    const id = text(row.id);
    const parentId = text(row.parent_property_id);
    const parent = parentId ? propertyById.get(parentId) ?? null : null;
    const propertyData = asObject(row.property_data);
    const legacyCode = text(row.legacy_code);
    const displayName = normalizeNameFromTranslations(row.translations, legacyCode);
    const projectLegacyCode =
      text(row.record_type) === "project"
        ? legacyCode
        : text(parent?.legacy_code) ?? null;

    return {
      property_id: id,
      legacy_code: legacyCode,
      display_name: displayName,
      record_type: text(row.record_type),
      status: text(row.status),
      parent_property_id: parentId,
      project_legacy_code: projectLegacyCode,
      unit_reference_hint: text(propertyData.unit_reference_hint),
      building_portal: text(propertyData.building_portal),
      floor_label: text(propertyData.floor_label),
      floor_level: propertyData.floor_level ?? null,
      building_door: text(propertyData.building_door),
      updated_at: text(row.updated_at),
      created_at: text(row.created_at),
    };
  });

  const clientsRaw = await fetchAllRows({
    db,
    table: "clients",
    select: [
      "id",
      "contact_id",
      "client_code",
      "client_type",
      "client_status",
      "billing_name",
      "tax_id",
      "profile_data",
      "updated_at",
      "created_at",
    ].join(","),
    organizationId,
    orderBy: "client_code",
  });

  const contactIds = Array.from(
    new Set(clientsRaw.map((row) => text(row.contact_id)).filter((value) => Boolean(value)))
  );

  const contactsById = new Map();
  const chunkSize = 300;
  for (let offset = 0; offset < contactIds.length; offset += chunkSize) {
    const chunk = contactIds.slice(offset, offset + chunkSize);
    const { data, error } = await db
      .schema("crm")
      .from("contacts")
      .select("id, full_name, email, phone")
      .eq("organization_id", organizationId)
      .in("id", chunk);

    if (error) throw new Error(`db_contacts_read_error:${error.message}`);

    (Array.isArray(data) ? data : []).forEach((row) => {
      const id = text(row.id);
      if (!id) return;
      contactsById.set(id, row);
    });
  }

  const clientsRows = clientsRaw.map((row) => {
    const contact = contactsById.get(text(row.contact_id)) ?? null;
    const profile = asObject(row.profile_data);
    return {
      client_id: text(row.id),
      client_code: text(row.client_code),
      full_name: text(contact?.full_name) ?? text(row.billing_name),
      email: text(contact?.email),
      phone: text(contact?.phone),
      tax_id: text(row.tax_id),
      client_type: text(row.client_type),
      client_status: text(row.client_status),
      tax_id_type: text(profile.tax_id_type),
      person_kind: text(profile.person_kind),
      nationality: text(profile.nationality),
      updated_at: text(row.updated_at),
      created_at: text(row.created_at),
    };
  });

  const outDirArg = text(arg("out-dir"));
  const outDir = outDirArg
    ? (path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT, outDirArg))
    : path.join(ROOT, "scripts", "client-import", "reference");
  ensureDir(outDir);

  const propertiesHeaders = [
    "property_id",
    "legacy_code",
    "display_name",
    "record_type",
    "status",
    "parent_property_id",
    "project_legacy_code",
    "unit_reference_hint",
    "building_portal",
    "floor_label",
    "floor_level",
    "building_door",
    "updated_at",
    "created_at",
  ];

  const clientsHeaders = [
    "client_id",
    "client_code",
    "full_name",
    "email",
    "phone",
    "tax_id",
    "client_type",
    "client_status",
    "tax_id_type",
    "person_kind",
    "nationality",
    "updated_at",
    "created_at",
  ];

  const propertiesCsv = toCsv(propertiesRows, propertiesHeaders);
  const clientsCsv = toCsv(clientsRows, clientsHeaders);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const propertiesPath = path.join(outDir, "properties-reference.csv");
  const clientsPath = path.join(outDir, "clients-reference.csv");
  const propertiesDatedPath = path.join(outDir, `properties-reference-${stamp}.csv`);
  const clientsDatedPath = path.join(outDir, `clients-reference-${stamp}.csv`);

  fs.writeFileSync(propertiesPath, propertiesCsv, "utf8");
  fs.writeFileSync(clientsPath, clientsCsv, "utf8");
  fs.writeFileSync(propertiesDatedPath, propertiesCsv, "utf8");
  fs.writeFileSync(clientsDatedPath, clientsCsv, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        organization_id: organizationId,
        properties_total: propertiesRows.length,
        clients_total: clientsRows.length,
        properties_csv: propertiesPath,
        clients_csv: clientsPath,
        properties_csv_snapshot: propertiesDatedPath,
        clients_csv_snapshot: clientsDatedPath,
      },
      null,
      2
    )
  );
};

main().catch((error) => {
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

