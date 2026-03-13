import { asText, asUuid, asObject, asNumber } from "@shared/portal/domain";
import { getProjectNameFromRow, getPropertyDisplayNameFromRow } from "@shared/properties/domain";

export const LEAD_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "property_id",
  "contact_id",
  "agency_id",
  "provider_id",
  "lead_kind",
  "origin_type",
  "source",
  "status",
  "priority",
  "operation_interest",
  "budget_min",
  "budget_max",
  "discarded_reason",
  "discarded_at",
  "converted_client_id",
  "converted_agency_id",
  "converted_at",
  "raw_payload",
  "created_at",
  "updated_at",
].join(", ");

export const CONTACT_SELECT_COLUMNS = ["id", "full_name", "email", "phone", "country_code", "updated_at"].join(", ");

export const PROPERTY_SELECT_COLUMNS = [
  "id",
  "legacy_code",
  "translations",
  "parent_property_id",
  "record_type",
  "listing_type",
  "status",
  "property_data",
].join(", ");

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
  "discarded",
] as const;

export const LEAD_ORIGIN_TYPES = [
  "direct",
  "website",
  "portal",
  "agency",
  "provider",
  "phone",
  "whatsapp",
  "email",
  "other",
] as const;

export const LEAD_KINDS = ["buyer", "seller", "landlord", "tenant", "investor", "agency", "provider", "other"] as const;
export const LEAD_OPERATION_INTERESTS = ["sale", "rent", "both"] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadOriginType = (typeof LEAD_ORIGIN_TYPES)[number];
export type LeadKind = (typeof LEAD_KINDS)[number];
export type LeadOperationInterest = (typeof LEAD_OPERATION_INTERESTS)[number];

const TREATED_NEW_STATUS = "new";

export const normalizeLeadStatus = (value: string | null, fallback: LeadStatus = "new"): LeadStatus => {
  if (!value) return fallback;
  return LEAD_STATUSES.includes(value as LeadStatus) ? (value as LeadStatus) : fallback;
};

export const normalizeLeadOriginType = (value: string | null, fallback: LeadOriginType = "other"): LeadOriginType => {
  if (!value) return fallback;
  return LEAD_ORIGIN_TYPES.includes(value as LeadOriginType) ? (value as LeadOriginType) : fallback;
};

export const normalizeLeadKind = (value: string | null, fallback: LeadKind = "buyer"): LeadKind => {
  if (!value) return fallback;
  return LEAD_KINDS.includes(value as LeadKind) ? (value as LeadKind) : fallback;
};

export const normalizeOperationInterest = (
  value: string | null,
  fallback: LeadOperationInterest = "sale"
): LeadOperationInterest => {
  if (!value) return fallback;
  if (value === "rental") return "rent";
  return LEAD_OPERATION_INTERESTS.includes(value as LeadOperationInterest) ? (value as LeadOperationInterest) : fallback;
};

export const normalizeEmail = (value: unknown): string | null => {
  const text = asText(value)?.toLowerCase();
  if (!text) return null;
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
};

export const normalizePhone = (value: unknown): string | null => {
  const text = asText(value);
  if (!text) return null;
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length < 6) return null;
  return collapsed;
};

export const normalizeNationality = (value: unknown): string | null => {
  const text = asText(value);
  if (!text) return null;
  return text;
};

export const normalizeNationalityKey = (value: string | null): string | null => {
  if (!value) return null;
  return value.toLowerCase();
};

export const asFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const projectLabel = (row: Record<string, unknown> | null): string | null => {
  if (!row) return null;
  return getProjectNameFromRow(row) ?? getPropertyDisplayNameFromRow(row);
};

const propertyLabel = (row: Record<string, unknown> | null): string | null => {
  if (!row) return null;
  return getPropertyDisplayNameFromRow(row);
};

export const buildLeadRows = (
  leads: Record<string, unknown>[],
  contactsById: Map<string, Record<string, unknown>>,
  propertiesById: Map<string, Record<string, unknown>>
) => {
  return leads.map((lead) => {
    const contactId = asUuid(lead.contact_id);
    const rawPayload = asObject(lead.raw_payload);
    const mappedPayload = asObject(rawPayload.mapped);
    const importPayload = asObject(rawPayload.import);
    const projectPayload = asObject(rawPayload.project);

    const propertyId = asUuid(lead.property_id) ?? asUuid(projectPayload.property_id);
    const agencyId = asUuid(lead.agency_id);
    const providerId = asUuid(lead.provider_id);
    const convertedClientId = asUuid(lead.converted_client_id);
    const convertedAgencyId = asUuid(lead.converted_agency_id);
    const contactRow = contactId ? contactsById.get(contactId) ?? null : null;
    const propertyRow = propertyId ? propertiesById.get(propertyId) ?? null : null;
    const propertyParentId = propertyRow ? asUuid(propertyRow.parent_property_id) : null;

    const projectRow = propertyParentId
      ? propertiesById.get(propertyParentId) ?? null
      : (propertyRow?.record_type === "project" ? propertyRow : null);

    const fullName = asText(contactRow?.full_name) ?? asText(mappedPayload.full_name);
    const email = asText(contactRow?.email) ?? asText(mappedPayload.email);
    const phone = asText(contactRow?.phone) ?? asText(mappedPayload.phone);
    const nationality = asText(contactRow?.country_code) ?? asText(mappedPayload.nationality);

    const status = asText(lead.status) as LeadStatus;
    const isTreated = status !== TREATED_NEW_STATUS;

    const source = asText(lead.source);
    const originType = asText(lead.origin_type);
    const operationInterest = asText(lead.operation_interest);
    const leadKind = asText(lead.lead_kind);
    const projectCode =
      asText(projectRow?.legacy_code) ??
      asText(projectPayload.project_legacy_code) ??
      asText(mappedPayload.project_legacy_code);
    const propertyCode =
      asText(propertyRow?.legacy_code) ??
      asText(projectPayload.property_legacy_code) ??
      asText(mappedPayload.property_legacy_code);
    const projectDisplay = projectLabel(projectRow) ?? projectCode;
    const propertyDisplayLabel = propertyLabel(propertyRow) ?? propertyCode ?? projectDisplay;

    const searchable = [
      fullName,
      email,
      phone,
      nationality,
      source,
      status,
      originType,
      operationInterest,
      leadKind,
      projectCode,
      projectDisplay,
      propertyCode,
      propertyDisplayLabel,
    ]
      .filter((entry) => Boolean(entry))
      .join(" ")
      .toLowerCase();

    return {
      id: asUuid(lead.id),
      contact_id: contactId,
      property_id: propertyId,
      agency_id: agencyId,
      provider_id: providerId,
      full_name: fullName,
      email,
      phone,
      nationality,
      nationality_normalized: normalizeNationalityKey(nationality),
      lead_kind: leadKind,
      origin_type: originType,
      source,
      status,
      is_treated: isTreated,
      priority: asNumber(lead.priority),
      operation_interest: operationInterest,
      budget_min: asNumber(lead.budget_min),
      budget_max: asNumber(lead.budget_max),
      discarded_reason: asText(lead.discarded_reason),
      discarded_at: asText(lead.discarded_at),
      converted_client_id: convertedClientId,
      converted_agency_id: convertedAgencyId,
      converted_at: asText(lead.converted_at),
      message: asText(mappedPayload.message) || asText((lead as any).message),
      property_code: propertyCode,
      property_label: propertyDisplayLabel,
      project_id: asUuid(projectRow?.id),
      project_code: projectCode,
      project_label: projectDisplay,
      created_at: asText(lead.created_at),
      updated_at: asText(lead.updated_at),
      search_blob: searchable,
    };
  });
};
