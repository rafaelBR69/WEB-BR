import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
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

const asText = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const asEnv = (key) => asText(process.env[key] ?? envFromFiles[key] ?? null);

const readArg = (flagName) => {
  const prefix = `--${flagName}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${flagName}`);
  if (index >= 0) return process.argv[index + 1] || null;
  return null;
};

const hasFlag = (flagName) => process.argv.includes(`--${flagName}`);

const splitCsv = (value) =>
  String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const chunk = (items, size) => {
  const output = [];
  for (let i = 0; i < items.length; i += size) {
    output.push(items.slice(i, i + size));
  }
  return output;
};

const fetchRootsByLegacyCode = async (client, organizationId, legacyCodes) => {
  const rows = [];
  for (const pack of chunk(legacyCodes, 100)) {
    const { data, error } = await client
      .schema("crm")
      .from("properties")
      .select("id, legacy_code, parent_property_id, record_type")
      .eq("organization_id", organizationId)
      .in("legacy_code", pack);
    if (error) throw new Error(`fetch_roots_failed: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return rows;
};

const fetchChildren = async (client, organizationId, parentIds) => {
  const rows = [];
  for (const pack of chunk(parentIds, 100)) {
    const { data, error } = await client
      .schema("crm")
      .from("properties")
      .select("id, legacy_code, parent_property_id, record_type")
      .eq("organization_id", organizationId)
      .in("parent_property_id", pack);
    if (error) throw new Error(`fetch_children_failed: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return rows;
};

const collectPropertyTree = async (client, organizationId, rootRows) => {
  const rowsById = new Map();
  const depthById = new Map();
  let frontier = [];

  rootRows.forEach((row) => {
    const id = String(row.id);
    rowsById.set(id, row);
    depthById.set(id, 0);
    frontier.push(id);
  });

  while (frontier.length) {
    const children = await fetchChildren(client, organizationId, frontier);
    const nextFrontier = [];

    children.forEach((row) => {
      const id = String(row.id);
      if (rowsById.has(id)) return;

      const parentId = asText(row.parent_property_id);
      const parentDepth = parentId ? depthById.get(parentId) ?? 0 : 0;
      rowsById.set(id, row);
      depthById.set(id, parentDepth + 1);
      nextFrontier.push(id);
    });

    frontier = nextFrontier;
  }

  return Array.from(rowsById.values())
    .map((row) => ({
      ...row,
      id: String(row.id),
      legacy_code: String(row.legacy_code),
      parent_property_id: asText(row.parent_property_id),
      record_type: String(row.record_type ?? "single"),
      depth: depthById.get(String(row.id)) ?? 0,
    }))
    .sort((a, b) => {
      if (b.depth !== a.depth) return b.depth - a.depth;
      return a.legacy_code.localeCompare(b.legacy_code);
    });
};

const deleteRowsByDepth = async (client, rows) => {
  const depthGroups = new Map();
  rows.forEach((row) => {
    const group = depthGroups.get(row.depth) ?? [];
    group.push(row.id);
    depthGroups.set(row.depth, group);
  });

  const orderedDepths = Array.from(depthGroups.keys()).sort((a, b) => b - a);
  for (const depth of orderedDepths) {
    const ids = depthGroups.get(depth) ?? [];
    for (const pack of chunk(ids, 100)) {
      const { error } = await client
        .schema("crm")
        .from("properties")
        .delete()
        .in("id", pack);
      if (error) throw new Error(`delete_failed_depth_${depth}: ${error.message}`);
    }
  }
};

const run = async () => {
  const organizationId = readArg("organization-id") ?? asEnv("CRM_ORGANIZATION_ID");
  const argCodes = splitCsv(readArg("legacy-codes"));
  const repeatedCodes = process.argv
    .filter((arg) => arg.startsWith("--legacy-code="))
    .flatMap((arg) => splitCsv(arg.slice("--legacy-code=".length)));
  const explicitCode = splitCsv(readArg("legacy-code"));
  const legacyCodes = Array.from(new Set([...argCodes, ...repeatedCodes, ...explicitCode]));
  const dryRun = hasFlag("dry-run");

  if (!organizationId || !UUID_RE.test(organizationId)) {
    throw new Error("organization_id_required_uuid (--organization-id or CRM_ORGANIZATION_ID)");
  }
  if (!legacyCodes.length) {
    throw new Error("legacy_code_required (--legacy-code PM0084 or --legacy-codes PM0084,PM0084-A1)");
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

  const rootRows = await fetchRootsByLegacyCode(client, organizationId, legacyCodes);
  const rootCodesFound = new Set(rootRows.map((row) => String(row.legacy_code)));
  const missingCodes = legacyCodes.filter((code) => !rootCodesFound.has(code));
  if (missingCodes.length) {
    throw new Error(`legacy_codes_not_found: ${missingCodes.join(", ")}`);
  }

  const treeRows = await collectPropertyTree(client, organizationId, rootRows);
  console.log(
    JSON.stringify(
      {
        organizationId,
        dryRun,
        requestedRoots: legacyCodes,
        deleteCount: treeRows.length,
        rows: treeRows.map((row) => ({
          legacy_code: row.legacy_code,
          record_type: row.record_type,
          parent_property_id: row.parent_property_id,
          depth: row.depth,
        })),
      },
      null,
      2
    )
  );

  if (dryRun) {
    console.log("Dry run completado. No se borraron propiedades en CRM.");
    return;
  }

  await deleteRowsByDepth(client, treeRows);

  const deletedIds = treeRows.map((row) => row.id);
  let remaining = 0;
  for (const pack of chunk(deletedIds, 100)) {
    const { count, error } = await client
      .schema("crm")
      .from("properties")
      .select("*", { head: true, count: "exact" })
      .in("id", pack);
    if (error) throw new Error(`verify_failed: ${error.message}`);
    remaining += count ?? 0;
  }

  console.log(
    JSON.stringify(
      {
        deleted: treeRows.length,
        remaining,
      },
      null,
      2
    )
  );
};

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`delete_crm_property_tree_failed: ${message}`);
  process.exit(1);
});
