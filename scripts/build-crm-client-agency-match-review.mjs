import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  ROOT,
  arg,
  canonical,
  parseEnvFile,
  readJson,
  relativeFromRoot,
  timestamp,
  txt,
  writeCsv,
  writeJson,
} from "./agency-import/shared.mjs";

const DEFAULT_DB_MAP_JSON = path.join(ROOT, "scripts", "agency-import", "reference", "agency-db-map-latest.json");
const REPORTS_DIR = path.join(ROOT, "scripts", "agency-import", "reports");

const resolveCliPath = (value, fallback) => {
  const selected = value ?? fallback;
  return path.isAbsolute(selected) ? selected : path.join(ROOT, selected);
};
const flag = (name) => process.argv.includes(`--${name}`);

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

const normalizePhone = (value) => {
  const text = txt(value);
  if (!text) return null;
  const digits = text.replace(/\D+/g, "");
  return digits.length >= 6 ? digits : null;
};

const normalizeEmail = (value) => {
  const text = txt(value);
  return text ? text.toLowerCase() : null;
};

const normalizeTaxId = (value) => {
  const text = txt(value);
  return text ? text.toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "") : null;
};

const canonicalName = (value) => {
  const text = canonical(value).replace(/\s+/g, " ").trim();
  return text || null;
};

const splitUnique = (values) => [...new Set(values.filter(Boolean))];

const parseReservationContactParts = (value) => {
  const text = txt(value);
  if (!text) {
    return {
      emails: [],
      phones: [],
      names: [],
    };
  }
  const emails = splitUnique((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((entry) => entry.toLowerCase()));
  const phones = splitUnique(
    (text.match(/\+?\d[\d\s().-]{5,}\d/g) ?? [])
      .map((entry) => normalizePhone(entry))
      .filter(Boolean)
  );
  const cleanedNames = text
    .split(/[|/]/)
    .map((entry) => entry.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " "))
    .map((entry) => entry.replace(/\+?\d[\d\s().-]{5,}\d/g, " "))
    .map((entry) => entry.replace(/\b(legal|agente|agent|agencia|agency|contacto)\b/gi, " "))
    .map((entry) => canonicalName(entry))
    .filter(Boolean);
  return {
    emails,
    phones,
    names: splitUnique(cleanedNames),
  };
};

const ORGANIZATION_ID = txt(arg("organization-id")) ?? env("CRM_ORGANIZATION_ID");
const SUPABASE_URL = env("SUPABASE_URL") ?? env("PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const DB_MAP_JSON = resolveCliPath(arg("db-map-json"), DEFAULT_DB_MAP_JSON);
const INCLUDE_IMPORTED = flag("include-imported");

if (!ORGANIZATION_ID) throw new Error("organization_id_required");
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("supabase_credentials_required");
if (!fs.existsSync(DB_MAP_JSON)) throw new Error(`db_map_json_not_found:${DB_MAP_JSON}`);

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const PAGE_SIZE = 1000;

const fetchAllRows = async (table, select) => {
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await db
      .schema("crm")
      .from(table)
      .select(select)
      .eq("organization_id", ORGANIZATION_ID)
      .range(from, to);
    if (error) throw new Error(`db_${table}_read_error:${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
};

const makeAgencyRow = (row) => ({
  dedupe_key: txt(row.dedupe_key),
  agency_id: txt(row.agency_id),
  agency_name: txt(row.agency_name),
  agent_name: txt(row.agent_name),
  email: normalizeEmail(row.email),
  phone: normalizePhone(row.phone),
  tax_id: normalizeTaxId(row.tax_id),
  agency_name_key: canonicalName(row.agency_name),
  agent_name_key: canonicalName(row.agent_name),
});

const buildClientSignal = (client, contact) => {
  const profile = client.profile_data && typeof client.profile_data === "object" ? client.profile_data : {};
  return {
    client_id: client.id,
    contact_id: txt(client.contact_id),
    billing_name: txt(client.billing_name),
    billing_name_key: canonicalName(client.billing_name),
    tax_id: normalizeTaxId(client.tax_id),
    profile_agency_name: txt(profile.agency_name),
    profile_agency_name_key: canonicalName(profile.agency_name),
    profile_agent_name: txt(profile.agent_name),
    profile_agent_name_key: canonicalName(profile.agent_name),
    entry_channel: txt(profile.entry_channel),
    import_source_key: txt(profile.import_source_key),
    email: normalizeEmail(contact?.email),
    phone: normalizePhone(contact?.phone),
    reservation_agency_names: [],
    reservation_agency_name_keys: [],
    reservation_agent_names: [],
    reservation_agent_name_keys: [],
    reservation_contact_emails: [],
    reservation_contact_phones: [],
    reservation_contact_names: [],
    reservation_contact_name_keys: [],
    reservation_sources: [],
  };
};

const applyReservationSignals = (client, reservationRows) => {
  const next = { ...client };
  const reservationAgencyNames = [];
  const reservationAgentNames = [];
  const reservationContactEmails = [];
  const reservationContactPhones = [];
  const reservationContactNames = [];
  const reservationSources = [];

  for (const row of reservationRows ?? []) {
    const agencyName = txt(row.agency_name);
    const agentName = txt(row.agent_name);
    if (agencyName) reservationAgencyNames.push(agencyName);
    if (agentName) reservationAgentNames.push(agentName);
    const contactParts = parseReservationContactParts(row.agency_contact);
    reservationContactEmails.push(...contactParts.emails);
    reservationContactPhones.push(...contactParts.phones);
    reservationContactNames.push(...contactParts.names);
    const sourceFile = txt(row.source_file);
    const sourceRowNumber = txt(String(row.source_row_number ?? ""));
    if (sourceFile && sourceRowNumber) reservationSources.push(`${sourceFile}#${sourceRowNumber}`);
  }

  next.reservation_agency_names = splitUnique(reservationAgencyNames);
  next.reservation_agency_name_keys = splitUnique(next.reservation_agency_names.map((value) => canonicalName(value)));
  next.reservation_agent_names = splitUnique(reservationAgentNames);
  next.reservation_agent_name_keys = splitUnique(next.reservation_agent_names.map((value) => canonicalName(value)));
  next.reservation_contact_emails = splitUnique(reservationContactEmails);
  next.reservation_contact_phones = splitUnique(reservationContactPhones);
  next.reservation_contact_names = splitUnique(reservationContactNames);
  next.reservation_contact_name_keys = splitUnique(next.reservation_contact_names.map((value) => canonicalName(value)));
  next.reservation_sources = splitUnique(reservationSources);

  return next;
};

const scoreMatch = (client, agency) => {
  let score = 0;
  const reasons = [];
  let hasTaxExact = false;
  let hasEmailExact = false;
  let hasPhoneExact = false;
  let hasAgencyNameExact = false;
  let hasAgentNameExact = false;
  let hasBillingNameExact = false;
  let hasReservationAgencyNameExact = false;
  let hasReservationAgentNameExact = false;
  let hasReservationContactEmailExact = false;
  let hasReservationContactPhoneExact = false;
  let hasReservationContactNameExact = false;

  if (client.tax_id && agency.tax_id && client.tax_id === agency.tax_id) {
    score += 140;
    reasons.push("tax_id_exact");
    hasTaxExact = true;
  }
  if (client.email && agency.email && client.email === agency.email) {
    score += 120;
    reasons.push("email_exact");
    hasEmailExact = true;
  }
  if (client.phone && agency.phone && client.phone === agency.phone) {
    score += 100;
    reasons.push("phone_exact");
    hasPhoneExact = true;
  }
  if (client.profile_agency_name_key && agency.agency_name_key && client.profile_agency_name_key === agency.agency_name_key) {
    score += 80;
    reasons.push("agency_name_exact");
    hasAgencyNameExact = true;
  }
  if (client.profile_agent_name_key && agency.agent_name_key && client.profile_agent_name_key === agency.agent_name_key) {
    score += 50;
    reasons.push("agent_name_exact");
    hasAgentNameExact = true;
  }
  if (client.billing_name_key && agency.agency_name_key && client.billing_name_key === agency.agency_name_key) {
    score += 40;
    reasons.push("billing_name_exact");
    hasBillingNameExact = true;
  }
  if (client.reservation_contact_emails.includes(agency.email)) {
    score += 130;
    reasons.push("reservation_contact_email_exact");
    hasReservationContactEmailExact = true;
  }
  if (client.reservation_contact_phones.includes(agency.phone)) {
    score += 110;
    reasons.push("reservation_contact_phone_exact");
    hasReservationContactPhoneExact = true;
  }
  if (client.reservation_agency_name_keys.includes(agency.agency_name_key)) {
    score += 95;
    reasons.push("reservation_agency_name_exact");
    hasReservationAgencyNameExact = true;
  }
  if (client.reservation_agent_name_keys.includes(agency.agent_name_key)) {
    score += 55;
    reasons.push("reservation_agent_name_exact");
    hasReservationAgentNameExact = true;
  }
  if (client.reservation_contact_name_keys.includes(agency.agent_name_key)) {
    score += 65;
    reasons.push("reservation_contact_name_exact");
    hasReservationContactNameExact = true;
  }

  let status = "unmatched";
  if (
    hasTaxExact ||
    hasEmailExact ||
    hasReservationContactEmailExact ||
    (hasPhoneExact && (hasAgencyNameExact || hasAgentNameExact || hasBillingNameExact)) ||
    (hasReservationContactPhoneExact && (hasReservationAgencyNameExact || hasReservationAgentNameExact || hasReservationContactNameExact)) ||
    (hasReservationAgencyNameExact && (hasReservationContactNameExact || hasReservationAgentNameExact))
  ) {
    status = "exact";
  } else if (
    hasPhoneExact ||
    hasAgencyNameExact ||
    hasReservationContactPhoneExact ||
    hasReservationAgencyNameExact ||
    (hasAgentNameExact && hasBillingNameExact) ||
    (hasReservationAgentNameExact && hasReservationAgencyNameExact) ||
    score >= 80
  ) {
    status = "candidate";
  } else if (score >= 40) {
    status = "manual_review";
  }

  return { score, reasons, status };
};

const main = async () => {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const [clients, contacts, reservations, dbMapRows] = await Promise.all([
    fetchAllRows("clients", "id, organization_id, contact_id, client_type, client_status, billing_name, tax_id, profile_data"),
    fetchAllRows("contacts", "id, organization_id, full_name, email, phone"),
    fetchAllRows(
      "client_project_reservations",
      "id, organization_id, client_id, agency_name, agency_contact, agent_name, source_file, source_row_number"
    ),
    readJson(DB_MAP_JSON),
  ]);
  const contactById = new Map(contacts.map((row) => [row.id, row]));
  const reservationsByClientId = new Map();
  reservations.forEach((row) => {
    const clientId = txt(row.client_id);
    if (!clientId) return;
    const bucket = reservationsByClientId.get(clientId) ?? [];
    bucket.push(row);
    reservationsByClientId.set(clientId, bucket);
  });
  const agencies = dbMapRows.map(makeAgencyRow).filter((row) => row.agency_id);

  const scopedClients = clients
    .map((client) => buildClientSignal(client, contactById.get(client.contact_id)))
    .map((client) => applyReservationSignals(client, reservationsByClientId.get(client.client_id) ?? []))
    .filter((row) => (INCLUDE_IMPORTED ? true : !row.import_source_key))
    .filter(
      (row) =>
        row.entry_channel === "agency" ||
        row.profile_agency_name_key ||
        row.profile_agent_name_key ||
        row.reservation_agency_name_keys.length ||
        row.reservation_agent_name_keys.length ||
        row.reservation_contact_emails.length ||
        row.reservation_contact_phones.length
    );

  const results = [];
  const totals = {
    clients_scoped: scopedClients.length,
    exact: 0,
    candidate: 0,
    manual_review: 0,
    unmatched: 0,
  };

  for (const client of scopedClients) {
    let best = null;
    for (const agency of agencies) {
      const match = scoreMatch(client, agency);
      if (match.score <= 0) continue;
      if (!best || match.score > best.match_score) {
        best = {
          match_status: match.status,
          match_score: match.score,
          match_reasons: match.reasons.join(" | "),
          agency_id: agency.agency_id ?? "",
          agency_dedupe_key: agency.dedupe_key ?? "",
          agency_name: agency.agency_name ?? "",
          agency_agent_name: agency.agent_name ?? "",
          agency_email: agency.email ?? "",
          agency_phone: agency.phone ?? "",
          agency_tax_id: agency.tax_id ?? "",
        };
      }
    }

    const row = {
      client_id: client.client_id,
      contact_id: client.contact_id ?? "",
      entry_channel: client.entry_channel ?? "",
      client_billing_name: client.billing_name ?? "",
      client_agency_name: client.profile_agency_name ?? "",
      client_agent_name: client.profile_agent_name ?? "",
      reservation_agency_name: client.reservation_agency_names.join(" | "),
      reservation_agent_name: client.reservation_agent_names.join(" | "),
      reservation_contact_email: client.reservation_contact_emails.join(" | "),
      reservation_contact_phone: client.reservation_contact_phones.join(" | "),
      reservation_contact_name: client.reservation_contact_names.join(" | "),
      reservation_sources: client.reservation_sources.join(" | "),
      client_email: client.email ?? "",
      client_phone: client.phone ?? "",
      client_tax_id: client.tax_id ?? "",
      match_status: best?.match_status ?? "unmatched",
      match_score: best?.match_score ?? 0,
      match_reasons: best?.match_reasons ?? "",
      agency_id: best?.agency_id ?? "",
      agency_dedupe_key: best?.agency_dedupe_key ?? "",
      agency_name: best?.agency_name ?? "",
      agency_agent_name: best?.agency_agent_name ?? "",
      agency_email: best?.agency_email ?? "",
      agency_phone: best?.agency_phone ?? "",
      agency_tax_id: best?.agency_tax_id ?? "",
    };

    totals[row.match_status] += 1;
    results.push(row);
  }

  const runTs = timestamp();
  const outputCsv = path.join(REPORTS_DIR, `client-agency-match-review-${runTs}.csv`);
  const reportJson = path.join(REPORTS_DIR, `client-agency-match-${runTs}.json`);

  writeCsv(outputCsv, results, [
    "client_id",
    "contact_id",
    "entry_channel",
    "client_billing_name",
    "client_agency_name",
    "client_agent_name",
    "reservation_agency_name",
    "reservation_agent_name",
    "reservation_contact_email",
    "reservation_contact_phone",
    "reservation_contact_name",
    "reservation_sources",
    "client_email",
    "client_phone",
    "client_tax_id",
    "match_status",
    "match_score",
    "match_reasons",
    "agency_id",
    "agency_dedupe_key",
    "agency_name",
    "agency_agent_name",
    "agency_email",
    "agency_phone",
    "agency_tax_id",
  ]);

  writeJson(reportJson, {
    generated_at: new Date().toISOString(),
    organization_id: ORGANIZATION_ID,
    db_map_json: relativeFromRoot(DB_MAP_JSON),
    totals,
    outputs: {
      review_csv: relativeFromRoot(outputCsv),
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        organization_id: ORGANIZATION_ID,
        include_imported: INCLUDE_IMPORTED,
        totals,
        outputs: {
          review_csv: relativeFromRoot(outputCsv),
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
