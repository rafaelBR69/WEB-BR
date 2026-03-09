import fs from "node:fs";
import path from "node:path";
import { asText, asUuid } from "@/utils/crmPortal";
import { getPropertyDisplayNameFromRow } from "@/utils/crmProperties";
import { getSupabaseServerClient } from "@/utils/supabaseServer";

export const PAGE_SIZE = 1000;
export const TERMINAL_LEAD_STATUSES = new Set(["converted", "won", "lost", "discarded", "junk"]);
const AGENCY_ATTRIBUTED_SUMMARY_PATH = path.join(
  process.cwd(),
  "scripts",
  "agency-import",
  "reference",
  "agency-attributed-summary-latest.json"
);

const EMAIL_RX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const AGENT_FIELD_RX = /(agente agencia|agency agent|agency_contact|contacto_agencia|nombre agente agencia)/i;
const PHONE_FIELD_RX = /(phone|telefono|telefono_|tel[eé]fono|movil|m[oó]vil|whatsapp|mobile)/i;

export type CrmRow = Record<string, unknown>;

export type AgencyAttributedMonthlyRow = {
  month_key: string;
  month_label: string;
  total: number;
  with_identity_total: number;
  without_identity_total: number;
  customer_total: number;
  discarded_total: number;
  active_total: number;
};

export type AgencyAttributedProjectRow = {
  project_label: string;
  project_legacy_code: string;
  total: number;
  with_identity_total: number;
  customer_total: number;
  discarded_total: number;
  active_total: number;
};

export type AgencyAttributedAgencyRow = {
  agency_id: string;
  agency_name: string;
  project_labels: string[];
  project_legacy_codes: string[];
  agency_names: string[];
  agent_names: string[];
  exact_matches_total: number;
  candidate_matches_total: number;
  attributed_records_total: number;
  records_with_identity_total: number;
  records_without_identity_total: number;
  records_with_strong_identity_total: number;
  customer_total: number;
  discarded_total: number;
  active_total: number;
  monthly_records: AgencyAttributedMonthlyRow[];
  status_breakdown: Array<{ status_label: string; total: number }>;
  project_mix: AgencyAttributedProjectRow[];
  source_files: Array<{ source_file: string; total: number }>;
  sample_lead_names: string[];
};

export type AgencyAttributedContactRow = {
  agency_contact_id: string;
  agency_id: string;
  agency_name: string;
  full_name: string;
  customer_name_samples: string[];
  attributed_records_total: number;
  records_with_identity_total: number;
  records_without_identity_total: number;
  records_with_strong_identity_total: number;
  customer_total: number;
  discarded_total: number;
  active_total: number;
  monthly_records: AgencyAttributedMonthlyRow[];
  status_breakdown: Array<{ status_label: string; total: number }>;
  project_mix: AgencyAttributedProjectRow[];
  source_files: Array<{ source_file: string; total: number }>;
  sample_lead_names: string[];
};

export type AgencyAttributedSummary = {
  generated_at: string;
  totals: {
    records_total: number;
    records_with_agency_context_total: number;
    matched_records_total: number;
    unmatched_records_total: number;
    ambiguous_records_total: number;
    manual_or_weak_records_total: number;
    records_with_identity_total: number;
    records_without_identity_total: number;
    records_with_strong_identity_total: number;
    customer_total: number;
    discarded_total: number;
    active_total: number;
  };
  overall: {
    attributed_records_total: number;
    records_with_identity_total: number;
    records_without_identity_total: number;
    records_with_strong_identity_total: number;
    customer_total: number;
    discarded_total: number;
    active_total: number;
    monthly_records: AgencyAttributedMonthlyRow[];
    status_breakdown: Array<{ status_label: string; total: number }>;
    project_mix: AgencyAttributedProjectRow[];
    source_files: Array<{ source_file: string; total: number }>;
    sample_lead_names: string[];
  };
  by_agency: AgencyAttributedAgencyRow[];
  by_contact?: AgencyAttributedContactRow[];
  unmatched_agencies: Array<Record<string, unknown>>;
};

export type AgencyAnalyticsContext = {
  organizationId: string;
  agencies: CrmRow[];
  clients: CrmRow[];
  contacts: CrmRow[];
  leads: CrmRow[];
  agencyContacts: CrmRow[];
  reservations: CrmRow[];
  properties: CrmRow[];
  agencyById: Map<string, CrmRow>;
  clientById: Map<string, CrmRow>;
  contactById: Map<string, CrmRow>;
  propertyById: Map<string, CrmRow>;
  agencyLabelById: Map<string, string>;
  linkedClientsByAgencyId: Map<string, CrmRow[]>;
  linkedClientIdsByAgencyId: Map<string, Set<string>>;
  reservedClientIds: Set<string>;
  reservationsByClientId: Map<string, CrmRow[]>;
  attributedSummary: AgencyAttributedSummary | null;
  attributedByAgencyId: Map<string, AgencyAttributedAgencyRow>;
  attributedByAgencyContactId: Map<string, AgencyAttributedContactRow>;
};

type AgencyMetricState = {
  agency_id: string;
  agency_name: string;
  agency_code: string | null;
  agency_status: string | null;
  is_referral_source: boolean;
  leads_total: number;
  leads_open_total: number;
  leads_converted_total: number;
  leads_won_total: number;
  converted_client_ids: Set<string>;
  linked_contacts_total: number;
  linked_clients_total: number;
  linked_reserved_clients_total: number;
  projects: Set<string>;
  attributed_records_total: number;
  attributed_records_with_identity_total: number;
  attributed_records_without_identity_total: number;
  attributed_records_with_strong_identity_total: number;
  attributed_records_customer_total: number;
  attributed_records_discarded_total: number;
  attributed_records_active_total: number;
};

type AgencyContactMetricState = {
  agency_contact_id: string;
  agency_id: string;
  agency_name: string;
  contact_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  relation_status: string;
  is_primary: boolean;
  leads_total: number;
  leads_open_total: number;
  leads_converted_total: number;
  converted_client_ids: Set<string>;
  matched_lead_ids: Set<string>;
  projects: Map<string, { project_id: string; leads_total: number; converted_clients_total: number }>;
  monthly: Map<string, { key: string; total: number; converted: number }>;
  statuses: Map<string, number>;
};

type CollapsedAgencyContactMetricRow = AgencyContactMetricRow & {
  alias_agency_contact_ids: string[];
};

export type AgencyMetricRow = {
  agency_id: string;
  agency_name: string;
  agency_code: string | null;
  agency_status: string | null;
  is_referral_source: boolean;
  leads_total: number;
  leads_open_total: number;
  leads_converted_total: number;
  leads_won_total: number;
  converted_clients_total: number;
  linked_contacts_total: number;
  linked_clients_total: number;
  linked_reserved_clients_total: number;
  projects_total: number;
  attributed_records_total: number;
  attributed_records_with_identity_total: number;
  attributed_records_without_identity_total: number;
  attributed_records_with_strong_identity_total: number;
  attributed_records_customer_total: number;
  attributed_records_discarded_total: number;
  attributed_records_active_total: number;
  lead_conversion_rate_pct: number;
  lead_to_client_rate_pct: number;
  linked_client_reservation_rate_pct: number;
  attributed_to_linked_client_rate_pct: number;
};

export type AgencyContactMetricRow = {
  agency_contact_id: string;
  agency_id: string;
  agency_name: string;
  contact_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  relation_status: string;
  is_primary: boolean;
  leads_total: number;
  leads_open_total: number;
  leads_converted_total: number;
  converted_clients_total: number;
  reserved_clients_total: number;
  attributed_records_total: number;
  attributed_records_with_identity_total: number;
  attributed_customer_total: number;
  attributed_discarded_total: number;
  attributed_active_total: number;
  projects_total: number;
  lead_conversion_rate_pct: number;
  attributed_customer_rate_pct: number;
  attributed_monthly_records: AgencyAttributedMonthlyRow[];
  attributed_status_breakdown: Array<{ status_label: string; total: number }>;
  attributed_project_mix: AgencyAttributedProjectRow[];
  monthly_leads: Array<{ month_key: string; month_label: string; total: number; converted: number }>;
  status_breakdown: Array<{ status: string; total: number }>;
  project_mix: Array<{
    project_id: string;
    project_label: string;
    leads_total: number;
    converted_clients_total: number;
  }>;
  converted_client_ids: string[];
  matched_lead_ids: string[];
  attributed_customer_name_samples: string[];
  attributed_lead_name_samples: string[];
  alias_agency_contact_ids?: string[];
};

export const fetchAllCrmRows = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  table: string,
  select: string,
  organizationId: string
) => {
  const rows: CrmRow[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await client
      .schema("crm")
      .from(table)
      .select(select)
      .eq("organization_id", organizationId)
      .range(from, to);

    if (error) throw new Error(`db_${table}_read_error:${error.message}`);
    const pageRows = Array.isArray(data) ? (data as CrmRow[]) : [];
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
};

export const monthKeyFromValue = (value: unknown) => {
  const text = asText(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

export const monthLabelFromKey = (value: string) => {
  const [year, month] = value.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("es-ES", { month: "short", year: "2-digit" });
};

const asObjectRecord = (value: unknown): CrmRow => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as CrmRow;
};

const asNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeName = (value: unknown) => {
  const text = asText(value);
  if (!text) return null;
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalized.length >= 3 ? normalized : null;
};

const normalizeEmail = (value: unknown) => {
  const text = asText(value)?.toLowerCase();
  if (!text) return null;
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
};

const normalizePhone = (value: unknown) => {
  const text = asText(value);
  if (!text) return null;
  const digits = text.replace(/\D+/g, "");
  return digits.length >= 6 ? digits : null;
};

const normalizeAgencyBrandKey = (value: unknown) => {
  const normalized = normalizeName(value);
  return normalized ? normalized.replace(/\s+/g, "") : null;
};

const isQuestionMarkName = (value: unknown) => {
  const text = asText(value)?.trim();
  if (!text) return true;
  return /^(\?|\¿)+$/.test(text);
};

const isGenericContactName = (contactName: unknown, agencyName: unknown) => {
  if (isQuestionMarkName(contactName)) return true;
  const normalizedContact = normalizeName(contactName);
  const normalizedAgency = normalizeName(agencyName);
  if (!normalizedContact) return true;
  if (!normalizedAgency) return false;
  if (normalizedContact === normalizedAgency) return true;
  return (
    normalizedContact.replace(/\s+/g, "") === normalizedAgency.replace(/\s+/g, "") ||
    normalizedContact.includes(normalizedAgency) ||
    normalizedAgency.includes(normalizedContact)
  );
};

const titleCaseFromEmailLocal = (value: unknown) => {
  const email = normalizeEmail(value);
  if (!email || !email.includes("@")) return null;
  const local = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  if (!local) return null;
  return local
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
};

const collectStringLeaves = (value: unknown, prefix = "", out: Array<{ path: string; value: string }> = []) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStringLeaves(item, prefix ? `${prefix}[${index}]` : `[${index}]`, out));
    return out;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const text = String(value).trim();
      if (text) out.push({ path: prefix, value: text });
    }
    return out;
  }

  Object.entries(value as CrmRow).forEach(([key, nested]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    collectStringLeaves(nested, nextPrefix, out);
  });
  return out;
};

const extractLeadAgentSignals = (lead: CrmRow) => {
  const payloadLeaves = collectStringLeaves(asObjectRecord(lead.raw_payload));
  const emails = new Set<string>();
  const phones = new Set<string>();
  const names = new Set<string>();

  payloadLeaves.forEach(({ path, value }) => {
    const normalizedPath = path.toLowerCase();
    const foundEmails = value.match(EMAIL_RX) ?? [];
    foundEmails.forEach((email) => {
      const normalized = normalizeEmail(email);
      if (normalized) emails.add(normalized);
    });

    if (PHONE_FIELD_RX.test(normalizedPath)) {
      const normalized = normalizePhone(value);
      if (normalized) phones.add(normalized);
    }

    if (AGENT_FIELD_RX.test(normalizedPath)) {
      const normalized = normalizeName(value);
      if (normalized) names.add(normalized);
      const phone = normalizePhone(value);
      if (phone) phones.add(phone);
      const email = normalizeEmail(value);
      if (email) emails.add(email);
    }
  });

  const mapped = asObjectRecord(asObjectRecord(lead.raw_payload).mapped);
  const mappedEmail = normalizeEmail(mapped.email);
  const mappedPhone = normalizePhone(mapped.phone);
  if (mappedEmail) emails.add(mappedEmail);
  if (mappedPhone) phones.add(mappedPhone);

  return { emails, phones, names };
};

const inferLeadAgencyContactId = (lead: CrmRow, candidates: AgencyContactMetricState[]) => {
  if (!candidates.length) return null;
  const signals = extractLeadAgentSignals(lead);
  let bestContactId: string | null = null;
  let bestScore = 0;
  let tie = false;

  candidates.forEach((candidate) => {
    let score = 0;
    const candidateEmail = normalizeEmail(candidate.email);
    const candidatePhone = normalizePhone(candidate.phone);
    const candidateName = normalizeName(candidate.full_name);

    if (candidateEmail && signals.emails.has(candidateEmail)) score = Math.max(score, 100);
    if (candidatePhone && signals.phones.has(candidatePhone)) score = Math.max(score, 90);
    if (candidateName) {
      signals.names.forEach((signalName) => {
        if (signalName === candidateName) score = Math.max(score, 70);
        if (signalName.length >= 5 && candidateName.length >= 5) {
          if (signalName.includes(candidateName) || candidateName.includes(signalName)) {
            score = Math.max(score, 55);
          }
        }
      });
    }

    if (score > bestScore) {
      bestContactId = candidate.agency_contact_id;
      bestScore = score;
      tie = false;
      return;
    }
    if (score > 0 && score === bestScore) tie = true;
  });

  if (tie || bestScore <= 0) return null;
  return bestContactId;
};

const getAgencyDisplayName = (
  agencyRow: CrmRow,
  clientById: Map<string, CrmRow>,
  contactById: Map<string, CrmRow>
) => {
  const baseClient = clientById.get(asUuid(agencyRow.client_id) ?? "") ?? null;
  const baseProfile = asObjectRecord(baseClient?.profile_data);
  const baseContact = contactById.get(asUuid(baseClient?.contact_id) ?? "") ?? null;
  return (
    asText(baseClient?.billing_name) ??
    asText(baseProfile.agency_name) ??
    asText(baseProfile.agent_name) ??
    asText(baseContact?.full_name) ??
    asText(agencyRow.agency_code) ??
    "Agencia"
  );
};

export const readAgencyAttributedSummary = (): AgencyAttributedSummary | null => {
  try {
    if (!fs.existsSync(AGENCY_ATTRIBUTED_SUMMARY_PATH)) return null;
    const raw = fs.readFileSync(AGENCY_ATTRIBUTED_SUMMARY_PATH, "utf8");
    const parsed = JSON.parse(raw) as AgencyAttributedSummary;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.by_agency)) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const buildAgencyAnalyticsContext = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  organizationId: string
): Promise<AgencyAnalyticsContext> => {
  const [agencies, clients, contacts, leads, agencyContacts, reservations, properties] = await Promise.all([
    fetchAllCrmRows(
      client,
      "agencies",
      "id, organization_id, client_id, agency_code, agency_status, agency_scope, parent_agency_id, is_referral_source, notes, created_at, updated_at",
      organizationId
    ),
    fetchAllCrmRows(
      client,
      "clients",
      "id, organization_id, contact_id, client_code, client_status, billing_name, tax_id, profile_data",
      organizationId
    ),
    fetchAllCrmRows(client, "contacts", "id, organization_id, full_name, email, phone", organizationId),
    fetchAllCrmRows(
      client,
      "leads",
      "id, organization_id, contact_id, agency_id, property_id, lead_kind, origin_type, source, status, converted_at, converted_client_id, created_at, updated_at, raw_payload",
      organizationId
    ),
    fetchAllCrmRows(
      client,
      "agency_contacts",
      "id, organization_id, agency_id, contact_id, role, relation_status, is_primary, notes",
      organizationId
    ),
    fetchAllCrmRows(
      client,
      "client_project_reservations",
      "id, organization_id, client_id, project_property_id, reservation_status, reservation_date",
      organizationId
    ),
    fetchAllCrmRows(
      client,
      "properties",
      "id, organization_id, legacy_code, record_type, property_data, translations",
      organizationId
    ),
  ]);

  const agencyById = new Map<string, CrmRow>();
  const clientById = new Map<string, CrmRow>();
  const contactById = new Map<string, CrmRow>();
  const propertyById = new Map<string, CrmRow>();

  agencies.forEach((row) => {
    const id = asUuid(row.id);
    if (id) agencyById.set(id, row);
  });
  clients.forEach((row) => {
    const id = asUuid(row.id);
    if (id) clientById.set(id, row);
  });
  contacts.forEach((row) => {
    const id = asUuid(row.id);
    if (id) contactById.set(id, row);
  });
  properties.forEach((row) => {
    const id = asUuid(row.id);
    if (id) propertyById.set(id, row);
  });

  const agencyLabelById = new Map<string, string>();
  agencies.forEach((agency) => {
    const agencyId = asUuid(agency.id);
    if (!agencyId) return;
    agencyLabelById.set(agencyId, getAgencyDisplayName(agency, clientById, contactById));
  });

  const reservedClientIds = new Set(
    reservations.map((row) => asUuid(row.client_id)).filter((value): value is string => Boolean(value))
  );
  const reservationsByClientId = new Map<string, CrmRow[]>();
  reservations.forEach((row) => {
    const clientId = asUuid(row.client_id);
    if (!clientId) return;
    const current = reservationsByClientId.get(clientId) ?? [];
    current.push(row);
    reservationsByClientId.set(clientId, current);
  });

  const linkedClientsByAgencyId = new Map<string, CrmRow[]>();
  const linkedClientIdsByAgencyId = new Map<string, Set<string>>();
  clients.forEach((row) => {
    const profileData = asObjectRecord(row.profile_data);
    const agencyId = asUuid(profileData.linked_agency_id);
    const clientId = asUuid(row.id);
    if (!agencyId || !clientId) return;
    const currentRows = linkedClientsByAgencyId.get(agencyId) ?? [];
    currentRows.push(row);
    linkedClientsByAgencyId.set(agencyId, currentRows);
    const currentIds = linkedClientIdsByAgencyId.get(agencyId) ?? new Set<string>();
    currentIds.add(clientId);
    linkedClientIdsByAgencyId.set(agencyId, currentIds);
  });

  const attributedSummary = readAgencyAttributedSummary();
  const attributedByAgencyId = new Map<string, AgencyAttributedAgencyRow>();
  const attributedByAgencyContactId = new Map<string, AgencyAttributedContactRow>();
  attributedSummary?.by_agency.forEach((row) => {
    const agencyId = asUuid(row.agency_id);
    if (!agencyId) return;
    attributedByAgencyId.set(agencyId, row);
  });
  (attributedSummary?.by_contact ?? []).forEach((row) => {
    const agencyContactId = asUuid(row.agency_contact_id);
    if (!agencyContactId) return;
    attributedByAgencyContactId.set(agencyContactId, row);
  });

  return {
    organizationId,
    agencies,
    clients,
    contacts,
    leads,
    agencyContacts,
    reservations,
    properties,
    agencyById,
    clientById,
    contactById,
    propertyById,
    agencyLabelById,
    linkedClientsByAgencyId,
    linkedClientIdsByAgencyId,
    reservedClientIds,
    reservationsByClientId,
    attributedSummary,
    attributedByAgencyId,
    attributedByAgencyContactId,
  };
};

export const buildAgencyMetrics = (context: AgencyAnalyticsContext) => {
  const metrics = new Map<string, AgencyMetricState>();

  context.agencies.forEach((agency) => {
    const agencyId = asUuid(agency.id);
    if (!agencyId) return;
    metrics.set(agencyId, {
      agency_id: agencyId,
      agency_name: context.agencyLabelById.get(agencyId) ?? "Agencia",
      agency_code: asText(agency.agency_code),
      agency_status: asText(agency.agency_status),
      is_referral_source: agency.is_referral_source !== false,
      leads_total: 0,
      leads_open_total: 0,
      leads_converted_total: 0,
      leads_won_total: 0,
      converted_client_ids: new Set<string>(),
      linked_contacts_total: 0,
      linked_clients_total: 0,
      linked_reserved_clients_total: 0,
      projects: new Set<string>(),
      attributed_records_total: 0,
      attributed_records_with_identity_total: 0,
      attributed_records_without_identity_total: 0,
      attributed_records_with_strong_identity_total: 0,
      attributed_records_customer_total: 0,
      attributed_records_discarded_total: 0,
      attributed_records_active_total: 0,
    });
  });

  context.agencyContacts.forEach((row) => {
    const agencyId = asUuid(row.agency_id);
    if (!agencyId || asText(row.relation_status) !== "active") return;
    const entry = metrics.get(agencyId);
    if (!entry) return;
    entry.linked_contacts_total += 1;
  });

  context.leads.forEach((lead) => {
    const agencyId = asUuid(lead.agency_id);
    if (!agencyId) return;
    const entry = metrics.get(agencyId);
    if (!entry) return;
    const status = asText(lead.status) ?? "new";
    entry.leads_total += 1;
    if (!TERMINAL_LEAD_STATUSES.has(status)) entry.leads_open_total += 1;
    if (status === "converted" || status === "won" || asText(lead.converted_at) || asUuid(lead.converted_client_id)) {
      entry.leads_converted_total += 1;
    }
    if (status === "won") entry.leads_won_total += 1;
    const convertedClientId = asUuid(lead.converted_client_id);
    if (convertedClientId) entry.converted_client_ids.add(convertedClientId);
    const projectId = asUuid(lead.property_id);
    if (projectId) entry.projects.add(projectId);
  });

  context.agencies.forEach((agency) => {
    const agencyId = asUuid(agency.id);
    if (!agencyId) return;
    const entry = metrics.get(agencyId);
    if (!entry) return;
    const linkedClients = context.linkedClientsByAgencyId.get(agencyId) ?? [];
    entry.linked_clients_total = linkedClients.length;
    entry.linked_reserved_clients_total = linkedClients.reduce((sum, clientRow) => {
      const clientId = asUuid(clientRow.id);
      if (!clientId) return sum;
      return sum + (context.reservedClientIds.has(clientId) ? 1 : 0);
    }, 0);

    const attributed = context.attributedByAgencyId.get(agencyId) ?? null;
    if (attributed) {
      entry.attributed_records_total = asNumber(attributed.attributed_records_total);
      entry.attributed_records_with_identity_total = asNumber(attributed.records_with_identity_total);
      entry.attributed_records_without_identity_total = asNumber(attributed.records_without_identity_total);
      entry.attributed_records_with_strong_identity_total = asNumber(attributed.records_with_strong_identity_total);
      entry.attributed_records_customer_total = asNumber(attributed.customer_total);
      entry.attributed_records_discarded_total = asNumber(attributed.discarded_total);
      entry.attributed_records_active_total = asNumber(attributed.active_total);
    }
  });

  return [...metrics.values()].map<AgencyMetricRow>((row) => ({
    agency_id: row.agency_id,
    agency_name: row.agency_name,
    agency_code: row.agency_code,
    agency_status: row.agency_status,
    is_referral_source: row.is_referral_source,
    leads_total: row.leads_total,
    leads_open_total: row.leads_open_total,
    leads_converted_total: row.leads_converted_total,
    leads_won_total: row.leads_won_total,
    converted_clients_total: row.converted_client_ids.size,
    linked_contacts_total: row.linked_contacts_total,
    linked_clients_total: row.linked_clients_total,
    linked_reserved_clients_total: row.linked_reserved_clients_total,
    projects_total: row.projects.size,
    attributed_records_total: row.attributed_records_total,
    attributed_records_with_identity_total: row.attributed_records_with_identity_total,
    attributed_records_without_identity_total: row.attributed_records_without_identity_total,
    attributed_records_with_strong_identity_total: row.attributed_records_with_strong_identity_total,
    attributed_records_customer_total: row.attributed_records_customer_total,
    attributed_records_discarded_total: row.attributed_records_discarded_total,
    attributed_records_active_total: row.attributed_records_active_total,
    lead_conversion_rate_pct: row.leads_total > 0 ? Math.round((row.leads_converted_total / row.leads_total) * 100) : 0,
    lead_to_client_rate_pct: row.leads_total > 0 ? Math.round((row.converted_client_ids.size / row.leads_total) * 100) : 0,
    linked_client_reservation_rate_pct:
      row.linked_clients_total > 0 ? Math.round((row.linked_reserved_clients_total / row.linked_clients_total) * 100) : 0,
    attributed_to_linked_client_rate_pct:
      row.attributed_records_total > 0 ? Math.round((row.linked_clients_total / row.attributed_records_total) * 100) : 0,
  }));
};

export const buildAgencyContactMetrics = (context: AgencyAnalyticsContext) => {
  const states = new Map<string, AgencyContactMetricState>();
  const candidatesByAgencyId = new Map<string, AgencyContactMetricState[]>();

  context.agencyContacts.forEach((row) => {
    const agencyContactId = asUuid(row.id);
    const agencyId = asUuid(row.agency_id);
    if (!agencyContactId || !agencyId) return;
    const relationStatus = asText(row.relation_status) ?? "active";
    const contact = context.contactById.get(asUuid(row.contact_id) ?? "") ?? null;
    const state: AgencyContactMetricState = {
      agency_contact_id: agencyContactId,
      agency_id: agencyId,
      agency_name: context.agencyLabelById.get(agencyId) ?? "Agencia",
      contact_id: asUuid(row.contact_id),
      full_name: asText(contact?.full_name),
      email: asText(contact?.email),
      phone: asText(contact?.phone),
      role: asText(row.role) ?? "agent",
      relation_status: relationStatus,
      is_primary: row.is_primary === true,
      leads_total: 0,
      leads_open_total: 0,
      leads_converted_total: 0,
      converted_client_ids: new Set<string>(),
      matched_lead_ids: new Set<string>(),
      projects: new Map(),
      monthly: new Map(),
      statuses: new Map(),
    };
    states.set(agencyContactId, state);
    if (relationStatus !== "active") return;
    const current = candidatesByAgencyId.get(agencyId) ?? [];
    current.push(state);
    candidatesByAgencyId.set(agencyId, current);
  });

  context.leads.forEach((lead) => {
    const agencyId = asUuid(lead.agency_id);
    const leadId = asUuid(lead.id);
    if (!agencyId || !leadId) return;
    const candidates = candidatesByAgencyId.get(agencyId) ?? [];
    if (!candidates.length) return;
    const matchedAgencyContactId = inferLeadAgencyContactId(lead, candidates);
    if (!matchedAgencyContactId) return;
    const state = states.get(matchedAgencyContactId);
    if (!state) return;

    const status = asText(lead.status) ?? "new";
    state.leads_total += 1;
    state.matched_lead_ids.add(leadId);
    if (!TERMINAL_LEAD_STATUSES.has(status)) state.leads_open_total += 1;
    if (status === "converted" || status === "won" || asText(lead.converted_at) || asUuid(lead.converted_client_id)) {
      state.leads_converted_total += 1;
    }
    state.statuses.set(status, (state.statuses.get(status) ?? 0) + 1);

    const monthKey = monthKeyFromValue(lead.created_at);
    if (monthKey) {
      const current = state.monthly.get(monthKey) ?? { key: monthKey, total: 0, converted: 0 };
      current.total += 1;
      if (status === "converted" || status === "won" || asText(lead.converted_at) || asUuid(lead.converted_client_id)) {
        current.converted += 1;
      }
      state.monthly.set(monthKey, current);
    }

    const projectId = asUuid(lead.property_id);
    if (projectId) {
      const current = state.projects.get(projectId) ?? {
        project_id: projectId,
        leads_total: 0,
        converted_clients_total: 0,
      };
      current.leads_total += 1;
      state.projects.set(projectId, current);
    }

    const convertedClientId = asUuid(lead.converted_client_id);
    if (convertedClientId) {
      state.converted_client_ids.add(convertedClientId);
      if (projectId) {
        const current = state.projects.get(projectId) ?? {
          project_id: projectId,
          leads_total: 0,
          converted_clients_total: 0,
        };
        current.converted_clients_total += 1;
        state.projects.set(projectId, current);
      }
    }
  });

  const rows = [...states.values()].map<CollapsedAgencyContactMetricRow>((state) => {
    const attributed = context.attributedByAgencyContactId.get(state.agency_contact_id) ?? null;
    const attributedRecordsTotal = asNumber(attributed?.attributed_records_total);
    const attributedCustomerTotal = asNumber(attributed?.customer_total);

    return {
    agency_contact_id: state.agency_contact_id,
    agency_id: state.agency_id,
    agency_name: state.agency_name,
    contact_id: state.contact_id,
    full_name: state.full_name,
    email: state.email,
    phone: state.phone,
    role: state.role,
    relation_status: state.relation_status,
    is_primary: state.is_primary,
    leads_total: state.leads_total,
    leads_open_total: state.leads_open_total,
    leads_converted_total: state.leads_converted_total,
    converted_clients_total: state.converted_client_ids.size,
    reserved_clients_total: [...state.converted_client_ids].filter((clientId) => context.reservedClientIds.has(clientId)).length,
    attributed_records_total: attributedRecordsTotal,
    attributed_records_with_identity_total: asNumber(attributed?.records_with_identity_total),
    attributed_customer_total: attributedCustomerTotal,
    attributed_discarded_total: asNumber(attributed?.discarded_total),
    attributed_active_total: asNumber(attributed?.active_total),
    projects_total: state.projects.size,
    lead_conversion_rate_pct: state.leads_total > 0 ? Math.round((state.leads_converted_total / state.leads_total) * 100) : 0,
    attributed_customer_rate_pct: attributedRecordsTotal > 0 ? Math.round((attributedCustomerTotal / attributedRecordsTotal) * 100) : 0,
    attributed_monthly_records: attributed?.monthly_records ?? [],
    attributed_status_breakdown: attributed?.status_breakdown ?? [],
    attributed_project_mix: attributed?.project_mix ?? [],
    monthly_leads: [...state.monthly.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-6)
      .map((row) => ({
        month_key: row.key,
        month_label: monthLabelFromKey(row.key),
        total: row.total,
        converted: row.converted,
      })),
    status_breakdown: [...state.statuses.entries()]
      .map(([status, total]) => ({ status, total }))
      .sort((a, b) => b.total - a.total),
    project_mix: [...state.projects.values()]
      .map((row) => {
        const propertyRow = context.propertyById.get(row.project_id) ?? null;
        return {
          project_id: row.project_id,
          project_label:
            getPropertyDisplayNameFromRow(propertyRow ?? {}) ??
            asText(propertyRow?.legacy_code) ??
            "Proyecto",
          leads_total: row.leads_total,
          converted_clients_total: row.converted_clients_total,
        };
      })
      .sort((a, b) => b.converted_clients_total + b.leads_total - (a.converted_clients_total + a.leads_total))
      .slice(0, 8),
    converted_client_ids: [...state.converted_client_ids],
    matched_lead_ids: [...state.matched_lead_ids],
    attributed_customer_name_samples: attributed?.customer_name_samples ?? [],
    attributed_lead_name_samples: attributed?.sample_lead_names ?? [],
    alias_agency_contact_ids: [state.agency_contact_id],
  };
  });

  const collapsed = new Map<string, CollapsedAgencyContactMetricRow>();

  rows.forEach((row) => {
    const identityKey =
      normalizeEmail(row.email) ??
      normalizePhone(row.phone) ??
      normalizeName(row.full_name) ??
      row.agency_contact_id;
    const collapseKey = `${normalizeAgencyBrandKey(row.agency_name) ?? row.agency_id}|${identityKey}`;
    const current = collapsed.get(collapseKey);
    if (!current) {
      collapsed.set(collapseKey, row);
      return;
    }

    const currentGeneric = isGenericContactName(current.full_name, current.agency_name);
    const nextGeneric = isGenericContactName(row.full_name, row.agency_name);
    const shouldReplaceIdentity =
      (currentGeneric && !nextGeneric) ||
      ((currentGeneric === nextGeneric) &&
        (row.attributed_records_total > current.attributed_records_total ||
          row.leads_total > current.leads_total ||
          Number(row.is_primary) > Number(current.is_primary)));

    if (shouldReplaceIdentity) {
      current.agency_contact_id = row.agency_contact_id;
      current.contact_id = row.contact_id;
      current.full_name =
        row.full_name ??
        current.full_name ??
        titleCaseFromEmailLocal(row.email) ??
        titleCaseFromEmailLocal(current.email);
      current.email = row.email ?? current.email;
      current.phone = row.phone ?? current.phone;
      current.role = row.role ?? current.role;
      current.relation_status = row.relation_status;
      current.is_primary = row.is_primary || current.is_primary;
    } else if (!current.full_name || isGenericContactName(current.full_name, current.agency_name)) {
      current.full_name =
        row.full_name ??
        current.full_name ??
        titleCaseFromEmailLocal(row.email) ??
        titleCaseFromEmailLocal(current.email);
    }

    current.alias_agency_contact_ids = [...new Set([...(current.alias_agency_contact_ids ?? []), row.agency_contact_id])];
    current.leads_total += row.leads_total;
    current.leads_open_total += row.leads_open_total;
    current.leads_converted_total += row.leads_converted_total;
    current.converted_clients_total += row.converted_clients_total;
    current.reserved_clients_total += row.reserved_clients_total;
    current.attributed_records_total += row.attributed_records_total;
    current.attributed_records_with_identity_total += row.attributed_records_with_identity_total;
    current.attributed_customer_total += row.attributed_customer_total;
    current.attributed_discarded_total += row.attributed_discarded_total;
    current.attributed_active_total += row.attributed_active_total;
    current.projects_total = Math.max(current.projects_total, row.projects_total);
    current.converted_client_ids = [...new Set([...current.converted_client_ids, ...row.converted_client_ids])];
    current.matched_lead_ids = [...new Set([...current.matched_lead_ids, ...row.matched_lead_ids])];
    current.attributed_customer_name_samples = [
      ...new Set([...current.attributed_customer_name_samples, ...row.attributed_customer_name_samples]),
    ].slice(0, 12);
    current.attributed_lead_name_samples = [
      ...new Set([...current.attributed_lead_name_samples, ...row.attributed_lead_name_samples]),
    ].slice(0, 12);

    const monthlyMap = new Map(
      current.monthly_leads.map((entry) => [entry.month_key, { ...entry }])
    );
    row.monthly_leads.forEach((entry) => {
      const existing = monthlyMap.get(entry.month_key) ?? { ...entry, total: 0, converted: 0 };
      existing.total += asNumber(entry.total);
      existing.converted += asNumber(entry.converted);
      monthlyMap.set(entry.month_key, existing);
    });
    current.monthly_leads = [...monthlyMap.values()]
      .sort((a, b) => a.month_key.localeCompare(b.month_key))
      .slice(-6);

    const attributedMonthlyMap = new Map(
      current.attributed_monthly_records.map((entry) => [entry.month_key, { ...entry }])
    );
    row.attributed_monthly_records.forEach((entry) => {
      const existing = attributedMonthlyMap.get(entry.month_key) ?? { ...entry, total: 0, with_identity_total: 0, without_identity_total: 0, customer_total: 0, discarded_total: 0, active_total: 0 };
      existing.total += asNumber(entry.total);
      existing.with_identity_total += asNumber(entry.with_identity_total);
      existing.without_identity_total += asNumber(entry.without_identity_total);
      existing.customer_total += asNumber(entry.customer_total);
      existing.discarded_total += asNumber(entry.discarded_total);
      existing.active_total += asNumber(entry.active_total);
      attributedMonthlyMap.set(entry.month_key, existing);
    });
    current.attributed_monthly_records = [...attributedMonthlyMap.values()].sort((a, b) => a.month_key.localeCompare(b.month_key));

    const statusMap = new Map(current.status_breakdown.map((entry) => [entry.status, asNumber(entry.total)]));
    row.status_breakdown.forEach((entry) => {
      statusMap.set(entry.status, (statusMap.get(entry.status) ?? 0) + asNumber(entry.total));
    });
    current.status_breakdown = [...statusMap.entries()]
      .map(([status, total]) => ({ status, total }))
      .sort((a, b) => b.total - a.total);

    const attributedStatusMap = new Map(
      current.attributed_status_breakdown.map((entry) => [entry.status_label, asNumber(entry.total)])
    );
    row.attributed_status_breakdown.forEach((entry) => {
      attributedStatusMap.set(entry.status_label, (attributedStatusMap.get(entry.status_label) ?? 0) + asNumber(entry.total));
    });
    current.attributed_status_breakdown = [...attributedStatusMap.entries()]
      .map(([status_label, total]) => ({ status_label, total }))
      .sort((a, b) => b.total - a.total);

    const projectMap = new Map(current.project_mix.map((entry) => [entry.project_id, { ...entry }]));
    row.project_mix.forEach((entry) => {
      const existing = projectMap.get(entry.project_id) ?? { ...entry, leads_total: 0, converted_clients_total: 0 };
      existing.leads_total += asNumber(entry.leads_total);
      existing.converted_clients_total += asNumber(entry.converted_clients_total);
      projectMap.set(entry.project_id, existing);
    });
    current.project_mix = [...projectMap.values()]
      .sort((a, b) => b.converted_clients_total + b.leads_total - (a.converted_clients_total + a.leads_total))
      .slice(0, 8);

    const attributedProjectMap = new Map(
      current.attributed_project_mix.map((entry) => [`${entry.project_legacy_code}|${entry.project_label}`, { ...entry }])
    );
    row.attributed_project_mix.forEach((entry) => {
      const key = `${entry.project_legacy_code}|${entry.project_label}`;
      const existing = attributedProjectMap.get(key) ?? {
        ...entry,
        total: 0,
        with_identity_total: 0,
        customer_total: 0,
        discarded_total: 0,
        active_total: 0,
      };
      existing.total += asNumber(entry.total);
      existing.with_identity_total += asNumber(entry.with_identity_total);
      existing.customer_total += asNumber(entry.customer_total);
      existing.discarded_total += asNumber(entry.discarded_total);
      existing.active_total += asNumber(entry.active_total);
      attributedProjectMap.set(key, existing);
    });
    current.attributed_project_mix = [...attributedProjectMap.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
  });

  return [...collapsed.values()].map((row) => ({
    ...row,
    full_name:
      (!isGenericContactName(row.full_name, row.agency_name) ? row.full_name : titleCaseFromEmailLocal(row.email)) ??
      row.full_name,
    converted_clients_total: row.converted_client_ids.length,
    reserved_clients_total: row.converted_client_ids.filter((clientId) => context.reservedClientIds.has(clientId)).length,
    projects_total: new Set(row.project_mix.map((entry) => entry.project_id)).size,
    lead_conversion_rate_pct: row.leads_total > 0 ? Math.round((row.leads_converted_total / row.leads_total) * 100) : 0,
    attributed_customer_rate_pct: row.attributed_records_total > 0 ? Math.round((row.attributed_customer_total / row.attributed_records_total) * 100) : 0,
  }));
};
