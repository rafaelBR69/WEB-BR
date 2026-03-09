import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  ROOT,
  arg,
  parseEnvFile,
  relativeFromRoot,
  timestamp,
  txt,
  writeCsv,
  writeJson,
} from "./agency-import/shared.mjs";

const DEFAULT_REVIEW_CSV = path.join(ROOT, "scripts", "agency-import", "reports", "client-agency-match-review-2026-03-04T10-35-22-358Z.csv");
const REPORTS_DIR = path.join(ROOT, "scripts", "agency-import", "reports");
const PAGE_SIZE = 1000;

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

const flag = (name) => process.argv.includes(`--${name}`);
const resolveCliPath = (value, fallback) => {
  const selected = value ?? fallback;
  return path.isAbsolute(selected) ? selected : path.join(ROOT, selected);
};

const parseCsv = (filePath) => {
  const text = fs.readFileSync(filePath, "utf8");
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
  if (row.some((entry) => String(entry ?? "").length > 0)) rows.push(row);
  const [header = [], ...body] = rows;
  return body.map((current) =>
    header.reduce((acc, key, index) => {
      acc[key] = current[index] ?? "";
      return acc;
    }, {})
  );
};

const APPLY = flag("apply");
const ORGANIZATION_ID = txt(arg("organization-id")) ?? env("CRM_ORGANIZATION_ID");
const SUPABASE_URL = env("SUPABASE_URL") ?? env("PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const REVIEW_CSV = resolveCliPath(arg("review-csv"), DEFAULT_REVIEW_CSV);
const MATCH_STATUS = txt(arg("match-status")) ?? "exact";

if (!ORGANIZATION_ID) throw new Error("organization_id_required");
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("supabase_credentials_required");
if (!fs.existsSync(REVIEW_CSV)) throw new Error(`review_csv_not_found:${REVIEW_CSV}`);

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const fetchAllClients = async () => {
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await db
      .schema("crm")
      .from("clients")
      .select("id, organization_id, profile_data")
      .eq("organization_id", ORGANIZATION_ID)
      .range(from, to);
    if (error) throw new Error(`db_clients_read_error:${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
};

const main = async () => {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const reviewRows = parseCsv(REVIEW_CSV).filter((row) => txt(row.match_status) === MATCH_STATUS);
  const clients = await fetchAllClients();
  const clientById = new Map(clients.map((row) => [txt(row.id), row]));

  const actions = [];
  let linked = 0;
  let alreadyLinked = 0;
  let conflicts = 0;
  let clientsMissing = 0;

  for (const row of reviewRows) {
    const clientId = txt(row.client_id);
    const agencyId = txt(row.agency_id);
    if (!clientId || !agencyId) {
      clientsMissing += 1;
      actions.push({
        status: "missing_ids",
        client_id: clientId ?? "",
        agency_id: agencyId ?? "",
        client_billing_name: row.client_billing_name ?? "",
        agency_name: row.agency_name ?? "",
        match_status: row.match_status ?? "",
        match_score: row.match_score ?? "",
      });
      continue;
    }

    const client = clientById.get(clientId) ?? null;
    if (!client) {
      clientsMissing += 1;
      actions.push({
        status: "client_not_found",
        client_id: clientId,
        agency_id: agencyId,
        client_billing_name: row.client_billing_name ?? "",
        agency_name: row.agency_name ?? "",
        match_status: row.match_status ?? "",
        match_score: row.match_score ?? "",
      });
      continue;
    }

    const profileData = client.profile_data && typeof client.profile_data === "object" ? { ...client.profile_data } : {};
    const existingAgencyId = txt(profileData.linked_agency_id);
    if (existingAgencyId && existingAgencyId === agencyId) {
      alreadyLinked += 1;
      actions.push({
        status: "already_linked",
        client_id: clientId,
        agency_id: agencyId,
        client_billing_name: row.client_billing_name ?? "",
        agency_name: row.agency_name ?? "",
        match_status: row.match_status ?? "",
        match_score: row.match_score ?? "",
      });
      continue;
    }

    if (existingAgencyId && existingAgencyId !== agencyId) {
      conflicts += 1;
      actions.push({
        status: "client_has_different_linked_agency",
        client_id: clientId,
        agency_id: agencyId,
        client_billing_name: row.client_billing_name ?? "",
        agency_name: row.agency_name ?? "",
        match_status: row.match_status ?? "",
        match_score: row.match_score ?? "",
      });
      continue;
    }

    const nextProfileData = {
      ...profileData,
      linked_agency_id: agencyId,
      linked_agency_name: txt(row.agency_name),
      linked_agency_dedupe_key: txt(row.agency_dedupe_key),
      linked_agency_match_status: txt(row.match_status),
      linked_agency_match_score: Number(row.match_score ?? 0) || 0,
      linked_agency_match_reasons: txt(row.match_reasons),
      linked_agency_source: path.basename(REVIEW_CSV),
      linked_agency_linked_at: new Date().toISOString(),
    };

    if (APPLY) {
      const { error } = await db
        .schema("crm")
        .from("clients")
        .update({ profile_data: nextProfileData })
        .eq("organization_id", ORGANIZATION_ID)
        .eq("id", clientId);
      if (error) throw new Error(`db_client_update_error:${error.message}`);
    }

    linked += 1;
    actions.push({
      status: APPLY ? "linked" : "would_link",
      client_id: clientId,
      agency_id: agencyId,
      client_billing_name: row.client_billing_name ?? "",
      agency_name: row.agency_name ?? "",
      match_status: row.match_status ?? "",
      match_score: row.match_score ?? "",
    });
  }

  const runTs = timestamp();
  const actionsCsv = path.join(REPORTS_DIR, `client-agency-link-actions-${runTs}.csv`);
  const reportJson = path.join(REPORTS_DIR, `client-agency-link-${runTs}.json`);

  writeCsv(actionsCsv, actions, [
    "status",
    "client_id",
    "agency_id",
    "client_billing_name",
    "agency_name",
    "match_status",
    "match_score",
  ]);
  writeJson(reportJson, {
    generated_at: new Date().toISOString(),
    apply: APPLY,
    organization_id: ORGANIZATION_ID,
    review_csv: relativeFromRoot(REVIEW_CSV),
    match_status: MATCH_STATUS,
    totals: {
      review_rows: reviewRows.length,
      linked,
      already_linked: alreadyLinked,
      conflicts,
      clients_missing: clientsMissing,
    },
    outputs: {
      actions_csv: relativeFromRoot(actionsCsv),
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        apply: APPLY,
        match_status: MATCH_STATUS,
        totals: {
          review_rows: reviewRows.length,
          linked,
          already_linked: alreadyLinked,
          conflicts,
          clients_missing: clientsMissing,
        },
        outputs: {
          actions_csv: relativeFromRoot(actionsCsv),
          report_json: relativeFromRoot(reportJson),
        },
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
  process.exit(1);
});
