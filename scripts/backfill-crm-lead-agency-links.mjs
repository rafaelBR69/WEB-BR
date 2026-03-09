import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  ROOT,
  arg,
  canonical,
  flag,
  isAgencyAgentPlaceholder,
  isAgencyPlaceholder,
  normalizeEmail,
  parseEnvFile,
  relativeFromRoot,
  timestamp,
  txt,
  writeCsv,
  writeJson,
} from "./agency-import/shared.mjs";

const REPORTS_DIR = path.join(ROOT, "scripts", "agency-import", "reports");
const APPLY = flag("apply");
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

const ORGANIZATION_ID = txt(arg("organization-id")) ?? env("CRM_ORGANIZATION_ID") ?? env("PUBLIC_CRM_ORGANIZATION_ID");
const SUPABASE_URL = env("SUPABASE_URL") ?? env("PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

if (!ORGANIZATION_ID) throw new Error("organization_id_required");
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("supabase_credentials_required");

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const fetchAllRows = async (table, select) => {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await db
      .schema("crm")
      .from(table)
      .select(select)
      .eq("organization_id", ORGANIZATION_ID)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`db_${table}_read_error:${error.message}`);
    const chunk = Array.isArray(data) ? data : [];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
};

const emailFromValue = (value) => normalizeEmail(value);

const normalizeName = (value) => {
  const normalized = canonical(value).replace(/\s+/g, " ").trim();
  return normalized.length >= 3 ? normalized : null;
};

const addUnique = (map, key, value) => {
  if (!key || !value) return;
  const current = map.get(key) ?? [];
  if (!current.includes(value)) current.push(value);
  map.set(key, current);
};

const rawAgencyNames = (rawRow) =>
  Object.entries(rawRow ?? {})
    .filter(([key, value]) => /nombre agencia|nombre comercial agencia|^agencia$|inmob/i.test(key) && txt(value))
    .map(([, value]) => normalizeName(value))
    .filter((value) => !isAgencyPlaceholder(value))
    .filter((value) => Boolean(value));

const rawAgencyContactNames = (rawRow) =>
  Object.entries(rawRow ?? {})
    .filter(([key, value]) => /agente agencia/i.test(key) && txt(value))
    .map(([, value]) => normalizeName(value))
    .filter((value) => !isAgencyAgentPlaceholder(value))
    .filter((value) => Boolean(value));

const rawAgencyContactEmails = (rawRow) =>
  Object.entries(rawRow ?? {})
    .map(([, value]) => emailFromValue(value))
    .filter((value) => Boolean(value));

const resolveLeadMatch = (lead, indexes) => {
  const rawPayload = lead?.raw_payload && typeof lead.raw_payload === "object" ? lead.raw_payload : {};
  const rawRow = rawPayload?.raw_row && typeof rawPayload.raw_row === "object" ? rawPayload.raw_row : {};
  const agencyNames = [...new Set(rawAgencyNames(rawRow))];
  const agencyContactNames = [...new Set(rawAgencyContactNames(rawRow))];
  const agencyContactEmails = [...new Set(rawAgencyContactEmails(rawRow))];
  const hasAgencyContext =
    agencyNames.length > 0 ||
    agencyContactNames.length > 0 ||
    txt(lead.origin_type) === "agency" ||
    txt(lead.lead_kind) === "agency";

  const candidates = new Set();
  const reasons = new Set();

  agencyNames.forEach((value) => {
    const matches = indexes.byAgencyName.get(value) ?? [];
    if (matches.length === 1) {
      candidates.add(matches[0]);
      reasons.add("agency_name_unique");
    }
  });

  agencyContactNames.forEach((value) => {
    const matches = indexes.byContactName.get(value) ?? [];
    if (matches.length === 1) {
      candidates.add(matches[0]);
      reasons.add("contact_name_unique");
    }
  });

  if (hasAgencyContext) {
    agencyContactEmails.forEach((value) => {
      const matches = indexes.byContactEmail.get(value) ?? [];
      if (matches.length === 1) {
        candidates.add(matches[0]);
        reasons.add("contact_email_with_context_unique");
      }
    });
  }

  return {
    agency_names: agencyNames,
    agency_contact_names: agencyContactNames,
    agency_contact_emails: agencyContactEmails,
    candidate_agency_ids: [...candidates],
    reasons: [...reasons].sort(),
    has_agency_context: hasAgencyContext,
  };
};

const main = async () => {
  const [agencies, clients, contacts, agencyContacts, leads] = await Promise.all([
    fetchAllRows("agencies", "id, organization_id, client_id, agency_code"),
    fetchAllRows("clients", "id, organization_id, contact_id, billing_name, profile_data"),
    fetchAllRows("contacts", "id, organization_id, full_name, email"),
    fetchAllRows("agency_contacts", "id, organization_id, agency_id, contact_id, relation_status"),
    fetchAllRows("leads", "id, organization_id, agency_id, origin_type, lead_kind, raw_payload"),
  ]);

  const clientById = new Map(clients.map((row) => [txt(row.id), row]));
  const contactById = new Map(contacts.map((row) => [txt(row.id), row]));

  const indexes = {
    byAgencyName: new Map(),
    byContactName: new Map(),
    byContactEmail: new Map(),
  };

  agencies.forEach((agency) => {
    const agencyId = txt(agency.id);
    const clientRow = clientById.get(txt(agency.client_id)) ?? {};
    const profileData = clientRow.profile_data && typeof clientRow.profile_data === "object" ? clientRow.profile_data : {};
    const baseContact = contactById.get(txt(clientRow.contact_id)) ?? {};

    [clientRow.billing_name, profileData.agency_name, agency.agency_code]
      .map((value) => normalizeName(value))
      .filter((value) => Boolean(value))
      .forEach((value) => addUnique(indexes.byAgencyName, value, agencyId));

    [baseContact.full_name, profileData.agent_name]
      .map((value) => normalizeName(value))
      .filter((value) => Boolean(value))
      .forEach((value) => addUnique(indexes.byContactName, value, agencyId));

    [baseContact.email]
      .map((value) => emailFromValue(value))
      .filter((value) => Boolean(value))
      .forEach((value) => addUnique(indexes.byContactEmail, value, agencyId));
  });

  agencyContacts.forEach((agencyContact) => {
    if (txt(agencyContact.relation_status) && txt(agencyContact.relation_status) !== "active") return;
    const agencyId = txt(agencyContact.agency_id);
    const contactRow = contactById.get(txt(agencyContact.contact_id)) ?? {};

    [contactRow.full_name]
      .map((value) => normalizeName(value))
      .filter((value) => Boolean(value))
      .forEach((value) => addUnique(indexes.byContactName, value, agencyId));

    [contactRow.email]
      .map((value) => emailFromValue(value))
      .filter((value) => Boolean(value))
      .forEach((value) => addUnique(indexes.byContactEmail, value, agencyId));
  });

  const actions = [];
  let eligible = 0;
  let linked = 0;
  let alreadyLinked = 0;
  let ambiguous = 0;
  let withoutContext = 0;

  for (const lead of leads) {
    const leadId = txt(lead.id);
    const currentAgencyId = txt(lead.agency_id);
    if (currentAgencyId) {
      alreadyLinked += 1;
      continue;
    }

    const match = resolveLeadMatch(lead, indexes);
    if (!match.has_agency_context) {
      withoutContext += 1;
      continue;
    }
    if (!match.candidate_agency_ids.length) continue;

    eligible += 1;

    if (match.candidate_agency_ids.length !== 1) {
      ambiguous += 1;
      actions.push({
        status: "ambiguous",
        lead_id: leadId ?? "",
        origin_type: txt(lead.origin_type) ?? "",
        lead_kind: txt(lead.lead_kind) ?? "",
        agency_id: "",
        reasons: match.reasons.join("|"),
        agency_names: match.agency_names.join(" | "),
        agency_contact_names: match.agency_contact_names.join(" | "),
        agency_contact_emails: match.agency_contact_emails.join(" | "),
        candidate_agency_ids: match.candidate_agency_ids.join(" | "),
      });
      continue;
    }

    const nextAgencyId = match.candidate_agency_ids[0];
    const nextRawPayload = {
      ...(lead.raw_payload ?? {}),
      agency_match: {
        ...((lead.raw_payload?.agency_match && typeof lead.raw_payload.agency_match === "object")
          ? lead.raw_payload.agency_match
          : {}),
        matched_at: new Date().toISOString(),
        match_status: "safe_backfill",
        reasons: match.reasons,
        agency_names: match.agency_names,
        agency_contact_names: match.agency_contact_names,
        agency_contact_emails: match.agency_contact_emails,
      },
    };

    if (APPLY) {
      const patch = {
        agency_id: nextAgencyId,
        raw_payload: nextRawPayload,
      };
      const { error } = await db
        .schema("crm")
        .from("leads")
        .update(patch)
        .eq("organization_id", ORGANIZATION_ID)
        .eq("id", leadId);
      if (error) throw new Error(`db_lead_update_error:${error.message}`);
    }

    linked += 1;
    actions.push({
      status: APPLY ? "linked" : "would_link",
      lead_id: leadId ?? "",
      origin_type: txt(lead.origin_type) ?? "",
      lead_kind: txt(lead.lead_kind) ?? "",
      agency_id: nextAgencyId,
      reasons: match.reasons.join("|"),
      agency_names: match.agency_names.join(" | "),
      agency_contact_names: match.agency_contact_names.join(" | "),
      agency_contact_emails: match.agency_contact_emails.join(" | "),
      candidate_agency_ids: nextAgencyId,
    });
  }

  const runTs = timestamp();
  const actionsCsv = path.join(REPORTS_DIR, `agency-lead-backfill-actions-${runTs}.csv`);
  const reportJson = path.join(REPORTS_DIR, `agency-lead-backfill-${runTs}.json`);

  writeCsv(actionsCsv, actions, [
    "status",
    "lead_id",
    "origin_type",
    "lead_kind",
    "agency_id",
    "reasons",
    "agency_names",
    "agency_contact_names",
    "agency_contact_emails",
    "candidate_agency_ids",
  ]);

  writeJson(reportJson, {
    generated_at: new Date().toISOString(),
    apply: APPLY,
    organization_id: ORGANIZATION_ID,
    totals: {
      leads_total: leads.length,
      leads_already_linked: alreadyLinked,
      leads_without_agency_context: withoutContext,
      leads_eligible: eligible,
      leads_linked: linked,
      leads_ambiguous: ambiguous,
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
        totals: {
          leads_total: leads.length,
          leads_already_linked: alreadyLinked,
          leads_without_agency_context: withoutContext,
          leads_eligible: eligible,
          leads_linked: linked,
          leads_ambiguous: ambiguous,
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
