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
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
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

const flag = (name) => {
  if (process.argv.includes(`--${name}`)) return true;
  const npmConfigKey = `npm_config_${name.replaceAll("-", "_")}`;
  const npmConfigValue = process.env[npmConfigKey];
  if (typeof npmConfigValue !== "string") return false;
  const normalized = npmConfigValue.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
};

const text = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const parseCsv = (raw) => {
  const textRaw = String(raw ?? "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < textRaw.length; i += 1) {
    const ch = textRaw[i];

    if (inQuotes) {
      if (ch === '"') {
        if (textRaw[i + 1] === '"') {
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

    if (ch === ",") {
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
  if (row.some((entry) => String(entry ?? "").length > 0) || rows.length === 0) rows.push(row);
  return rows;
};

const parseCsvFile = (filePath) => {
  if (!fs.existsSync(filePath)) throw new Error(`csv_file_not_found:${filePath}`);
  const rows = parseCsv(fs.readFileSync(filePath, "utf8"));
  if (!rows.length) return [];
  const headers = rows[0].map((entry) => text(entry) ?? "");

  return rows
    .slice(1)
    .map((values) => {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = text(values[index]);
      });
      return row;
    })
    .filter((row) => Object.values(row).some((entry) => text(entry)));
};

const parseBool = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "si", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
};

const parseNumber = (value) => {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Number(raw.replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const normalizeBuyerRole = (value) => {
  const raw = text(value);
  if (raw === "primary" || raw === "co_buyer" || raw === "legal_representative" || raw === "other") {
    return raw;
  }
  return "primary";
};

const normalizeLinkSource = (value) => {
  const raw = text(value);
  if (raw === "manual" || raw === "reservation_import" || raw === "contract_import" || raw === "script" || raw === "other") {
    return raw;
  }
  return "script";
};

const ensureDir = (absolutePath) => {
  if (!fs.existsSync(absolutePath)) fs.mkdirSync(absolutePath, { recursive: true });
};

const appendNote = (current, extra) => {
  const base = text(current);
  const add = text(extra);
  if (!add) return base;
  if (!base) return add;
  if (base.includes(add)) return base;
  return `${base}; ${add}`;
};

const main = async () => {
  const defaultCsvFile = path.join(
    ROOT,
    "scripts",
    "client-import",
    "reference",
    "property-client-links-draft.csv"
  );
  const csvFileArg =
    text(arg("csv-file")) ??
    text(process.env.CLIENT_LINKS_CSV_FILE) ??
    (fs.existsSync(defaultCsvFile) ? defaultCsvFile : null);
  if (!csvFileArg) throw new Error("csv_file_required");

  const csvFile = path.isAbsolute(csvFileArg) ? csvFileArg : path.join(ROOT, csvFileArg);

  const organizationId =
    text(arg("organization-id")) ??
    text(env("CRM_ORGANIZATION_ID")) ??
    text(env("PUBLIC_CRM_ORGANIZATION_ID"));
  if (!organizationId || !UUID_RX.test(organizationId)) throw new Error("organization_id_invalid");

  const supabaseUrl = text(env("SUPABASE_URL")) ?? text(env("PUBLIC_SUPABASE_URL"));
  const supabaseKey =
    text(env("SUPABASE_SERVICE_ROLE_KEY")) ??
    text(env("SUPABASE_ANON_KEY")) ??
    text(env("PUBLIC_SUPABASE_ANON_KEY"));
  if (!supabaseUrl || !supabaseKey) throw new Error("supabase_env_missing");

  const dryRun = flag("dry-run");
  const continueOnError = flag("continue-on-error");
  const includeUnready = flag("include-unready");
  const allowLowConfidence = flag("allow-low-confidence");
  const limitRaw = Number(arg("limit"));
  const rowLimit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : null;

  const rows = parseCsvFile(csvFile);
  if (!rows.length) throw new Error("csv_empty");

  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  const { error: probeError } = await db
    .schema("crm")
    .from("property_client_links")
    .select("id")
    .limit(1);

  if (probeError) {
    const code = String(probeError.code ?? "");
    const message = String(probeError.message ?? "").toLowerCase();
    if (code === "PGRST205" || message.includes("property_client_links")) {
      throw new Error("missing_table_property_client_links_apply_migration_009");
    }
    throw new Error(`db_property_client_links_probe_error:${probeError.message}`);
  }

  const stats = {
    dry_run: dryRun,
    rows_total: rows.length,
    rows_processed: 0,
    rows_skipped_not_ready: 0,
    rows_skipped_low_confidence: 0,
    rows_skipped_invalid_ids: 0,
    primary_conflicts_detected: 0,
    existing_primaries_deactivated: 0,
    incoming_marked_inactive: 0,
    links_upserted: 0,
    errors: 0,
  };

  const errors = [];
  let processed = 0;
  const propertyIdsFromCsv = [...new Set(rows.map((row) => text(row.property_id)).filter((id) => id && UUID_RX.test(id)))];
  const activePrimaryByProperty = new Map();
  const existingLinksByPropertyClient = new Map();

  if (propertyIdsFromCsv.length) {
    const { data: existingLinks, error: existingLinksError } = await db
      .schema("crm")
      .from("property_client_links")
      .select("id,property_id,client_id,buyer_role,is_active,link_source,notes")
      .eq("organization_id", organizationId)
      .in("property_id", propertyIdsFromCsv);

    if (existingLinksError) {
      throw new Error(`db_existing_links_read_error:${existingLinksError.message}`);
    }

    for (const row of existingLinks ?? []) {
      const propertyId = text(row.property_id);
      const clientId = text(row.client_id);
      if (!propertyId) continue;
      if (clientId) {
        existingLinksByPropertyClient.set(`${propertyId}|${clientId}`, row);
      }

      if (!(row.is_active && row.buyer_role === "primary")) continue;
      const bucket = activePrimaryByProperty.get(propertyId) ?? [];
      bucket.push(row);
      activePrimaryByProperty.set(propertyId, bucket);
    }
  }

  for (const row of rows) {
    if (rowLimit && processed >= rowLimit) break;

    const ready = parseBool(row.ready_to_apply, false);
    if (!includeUnready && !ready) {
      stats.rows_skipped_not_ready += 1;
      continue;
    }

    if (!allowLowConfidence) {
      const clientConfidence = text(row.client_match_confidence);
      const propertyConfidence = text(row.property_match_confidence);
      const isLowConfidence =
        clientConfidence === "low" ||
        propertyConfidence === "low" ||
        clientConfidence === "none" ||
        propertyConfidence === "none";
      if (isLowConfidence) {
        stats.rows_skipped_low_confidence += 1;
        continue;
      }
    }

    const propertyId = text(row.property_id);
    const clientId = text(row.client_id);

    if (!propertyId || !clientId || !UUID_RX.test(propertyId) || !UUID_RX.test(clientId)) {
      stats.rows_skipped_invalid_ids += 1;
      if (continueOnError) {
        errors.push({
          source_file: row.source_file,
          source_row_number: row.source_row_number,
          error: "invalid_uuid_ids",
          property_id: propertyId,
          client_id: clientId,
        });
        continue;
      }
      throw new Error(`invalid_uuid_ids:property_id=${propertyId ?? "null"}:client_id=${clientId ?? "null"}`);
    }

    const payload = {
      organization_id: organizationId,
      property_id: propertyId,
      client_id: clientId,
      buyer_role: normalizeBuyerRole(row.buyer_role),
      civil_status: text(row.civil_status),
      marital_regime: text(row.marital_regime),
      ownership_share: parseNumber(row.ownership_share),
      is_active: parseBool(row.is_active, true),
      link_source: normalizeLinkSource(row.link_source),
      notes: text(row.notes),
      metadata: {
        source_file: text(row.source_file),
        source_row_number: text(row.source_row_number),
        reservation_state_text: text(row.reservation_state_text),
        unit_reference: text(row.unit_reference),
        client_match_method: text(row.client_match_method),
        property_match_method: text(row.property_match_method),
        client_match_confidence: text(row.client_match_confidence),
        property_match_confidence: text(row.property_match_confidence),
      },
    };
    const propertyClientKey = `${propertyId}|${clientId}`;
    const existingExactLink = existingLinksByPropertyClient.get(propertyClientKey) ?? null;

    if (payload.is_active && payload.buyer_role === "primary") {
      const currentPrimaries = activePrimaryByProperty.get(propertyId) ?? [];
      const conflictingPrimary = currentPrimaries.find((entry) => text(entry.client_id) && text(entry.client_id) !== clientId);

      if (conflictingPrimary) {
        stats.primary_conflicts_detected += 1;
        const existingSource = text(conflictingPrimary.link_source);
        const canDeactivateExisting =
          existingSource === "script" ||
          existingSource === "reservation_import" ||
          existingSource === "contract_import";

        if (canDeactivateExisting) {
          if (!dryRun) {
            const nextNotes = appendNote(
              conflictingPrimary.notes,
              `auto-desactivado por importacion CSV ${new Date().toISOString()}`
            );
            const { error: deactivateError } = await db
              .schema("crm")
              .from("property_client_links")
              .update({ is_active: false, notes: nextNotes })
              .eq("organization_id", organizationId)
              .eq("id", conflictingPrimary.id);

            if (deactivateError) {
              throw new Error(`db_primary_conflict_deactivate_error:${deactivateError.message}`);
            }
          }

          const survivors = currentPrimaries.filter((entry) => entry.id !== conflictingPrimary.id);
          activePrimaryByProperty.set(propertyId, survivors);
          stats.existing_primaries_deactivated += 1;
        } else {
          payload.is_active = false;
          payload.notes = appendNote(
            payload.notes,
            `marcado inactivo: ya existe primary activo (${existingSource ?? "manual"})`
          );
          stats.incoming_marked_inactive += 1;
        }
      }
    }

    try {
      if (!dryRun) {
        if (existingExactLink?.id) {
          const { data: updated, error } = await db
            .schema("crm")
            .from("property_client_links")
            .update(payload)
            .eq("organization_id", organizationId)
            .eq("id", existingExactLink.id)
            .select("id,property_id,client_id,buyer_role,is_active,link_source,notes")
            .single();
          if (error) throw new Error(`db_property_client_link_update_error:${error.message}`);
          existingLinksByPropertyClient.set(
            propertyClientKey,
            updated ?? {
              ...existingExactLink,
              ...payload,
            }
          );
        } else {
          const { data: inserted, error } = await db
            .schema("crm")
            .from("property_client_links")
            .insert(payload)
            .select("id,property_id,client_id,buyer_role,is_active,link_source,notes")
            .single();
          if (error) throw new Error(`db_property_client_link_insert_error:${error.message}`);
          existingLinksByPropertyClient.set(
            propertyClientKey,
            inserted ?? {
              ...payload,
              id: null,
            }
          );
        }
      } else {
        existingLinksByPropertyClient.set(
          propertyClientKey,
          existingExactLink
            ? {
                ...existingExactLink,
                ...payload,
              }
            : {
                ...payload,
                id: null,
              }
        );
      }

      if (payload.is_active && payload.buyer_role === "primary") {
        activePrimaryByProperty.set(
          propertyId,
          [
            ...(activePrimaryByProperty.get(propertyId) ?? []).filter((entry) => text(entry.client_id) !== clientId),
            {
              id: existingExactLink?.id ?? null,
              property_id: propertyId,
              client_id: clientId,
              buyer_role: "primary",
              is_active: true,
              link_source: payload.link_source,
              notes: payload.notes,
            },
          ]
        );
      } else {
        const keep = (activePrimaryByProperty.get(propertyId) ?? []).filter((entry) => text(entry.client_id) !== clientId);
        if (keep.length) activePrimaryByProperty.set(propertyId, keep);
        else activePrimaryByProperty.delete(propertyId);
      }

      stats.rows_processed += 1;
      stats.links_upserted += 1;
      processed += 1;
    } catch (error) {
      stats.errors += 1;
      const errorText = error instanceof Error ? error.message : String(error);
      errors.push({
        source_file: row.source_file,
        source_row_number: row.source_row_number,
        error: errorText,
      });
      if (!continueOnError) throw error;
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = path.join(ROOT, "scripts", "client-import", "reports");
  ensureDir(reportDir);
  const reportPath = path.join(reportDir, `property-client-links-apply-${stamp}.json`);

  const reportPayload = {
    ok: true,
    generated_at: new Date().toISOString(),
    organization_id: organizationId,
    csv_file: csvFile,
    stats,
    errors,
  };

  fs.writeFileSync(reportPath, JSON.stringify(reportPayload, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        report_path: reportPath,
        stats,
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

