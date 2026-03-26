import { asText, asUuid, asObject, asNumber } from "../portal/domain.ts";
import { getProjectNameFromRow, getPropertyDisplayNameFromRow } from "../properties/domain.ts";

export const LEAD_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "property_id",
  "contact_id",
  "assigned_to",
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

export const PROPERTY_CONTEXT_SELECT_COLUMNS = ["id", "legacy_code", "parent_property_id", "record_type"].join(", ");

export const LEAD_STATUSES = [
  "new",
  "in_process",
  "qualified",
  "visit_scheduled",
  "offer_sent",
  "negotiation",
  "converted",
  "lost",
  "discarded",
  "junk",
] as const;

export const LEAD_MUTABLE_STATUSES = [
  "new",
  "in_process",
  "qualified",
  "visit_scheduled",
  "offer_sent",
  "negotiation",
  "lost",
  "discarded",
  "junk",
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
export type LeadMutableStatus = (typeof LEAD_MUTABLE_STATUSES)[number];

const TREATED_NEW_STATUS = "new";
const LEAD_STATUS_ALIASES: Record<string, LeadStatus> = {
  contacted: "in_process",
  proposal: "offer_sent",
  won: "converted",
};
const LEAD_STATUS_SET = new Set<string>(LEAD_STATUSES);

export const parseLeadStatus = (value: unknown): LeadStatus | null => {
  const text = asText(value)?.toLowerCase();
  if (!text) return null;
  const normalized = LEAD_STATUS_ALIASES[text] ?? text;
  return LEAD_STATUS_SET.has(normalized) ? (normalized as LeadStatus) : null;
};

export const normalizeLeadStatus = (value: string | null, fallback: LeadStatus = "new"): LeadStatus => {
  return parseLeadStatus(value) ?? fallback;
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
  if (value === "mixed") return "both";
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

export const isTerminalLeadStatus = (value: unknown) => {
  const status = parseLeadStatus(value);
  return status === "converted" || status === "lost" || status === "discarded" || status === "junk";
};

export type LeadPropertyContextResolution = {
  propertyId: string | null;
  propertyLegacyCode: string | null;
  propertyRecordType: string | null;
  projectId: string | null;
  projectLegacyCode: string | null;
  projectRecordType: string | null;
  error: string | null;
};

export const resolveLeadPropertyContext = async (
  client: any,
  organizationId: string,
  input: {
    propertyId: string | null;
    projectId: string | null;
    propertyLegacyCode: string | null;
  }
): Promise<LeadPropertyContextResolution> => {
  const readPropertyById = async (propertyId: string, errorPrefix: string) => {
    const { data, error } = await client
      .schema("crm")
      .from("properties")
      .select(PROPERTY_CONTEXT_SELECT_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("id", propertyId)
      .maybeSingle();
    if (error) return { row: null, error: `${errorPrefix}:${error.message}` };
    return { row: (data as Record<string, unknown> | null) ?? null, error: null };
  };

  const buildContext = async (propertyRow: Record<string, unknown> | null): Promise<LeadPropertyContextResolution> => {
    if (!propertyRow) {
      return {
        propertyId: null,
        propertyLegacyCode: null,
        propertyRecordType: null,
        projectId: null,
        projectLegacyCode: null,
        projectRecordType: null,
        error: null,
      };
    }

    const propertyId = asUuid(propertyRow.id);
    if (!propertyId) {
      return {
        propertyId: null,
        propertyLegacyCode: null,
        propertyRecordType: null,
        projectId: null,
        projectLegacyCode: null,
        projectRecordType: null,
        error: "property_invalid_shape",
      };
    }

    let projectRow = propertyRow;
    const parentPropertyId = asUuid(propertyRow.parent_property_id);
    if (parentPropertyId) {
      const parentRead = await readPropertyById(parentPropertyId, "db_project_parent_read_error");
      if (parentRead.error) {
        return {
          propertyId,
          propertyLegacyCode: asText(propertyRow.legacy_code),
          propertyRecordType: asText(propertyRow.record_type),
          projectId: null,
          projectLegacyCode: null,
          projectRecordType: null,
          error: parentRead.error,
        };
      }
      if (parentRead.row) projectRow = parentRead.row;
    }

    return {
      propertyId,
      propertyLegacyCode: asText(propertyRow.legacy_code),
      propertyRecordType: asText(propertyRow.record_type),
      projectId: asUuid(projectRow.id),
      projectLegacyCode: asText(projectRow.legacy_code),
      projectRecordType: asText(projectRow.record_type),
      error: null,
    };
  };

  if (input.propertyId) {
    const propertyRead = await readPropertyById(input.propertyId, "db_property_read_error");
    if (propertyRead.error) {
      return {
        propertyId: null,
        propertyLegacyCode: null,
        propertyRecordType: null,
        projectId: null,
        projectLegacyCode: null,
        projectRecordType: null,
        error: propertyRead.error,
      };
    }
    if (!propertyRead.row) {
      return {
        propertyId: null,
        propertyLegacyCode: null,
        propertyRecordType: null,
        projectId: null,
        projectLegacyCode: null,
        projectRecordType: null,
        error: "property_id_not_found",
      };
    }
    return buildContext(propertyRead.row);
  }

  if (input.projectId) {
    const projectRead = await readPropertyById(input.projectId, "db_project_read_error");
    if (projectRead.error) {
      return {
        propertyId: null,
        propertyLegacyCode: null,
        propertyRecordType: null,
        projectId: null,
        projectLegacyCode: null,
        projectRecordType: null,
        error: projectRead.error,
      };
    }
    if (!projectRead.row) {
      return {
        propertyId: null,
        propertyLegacyCode: null,
        propertyRecordType: null,
        projectId: null,
        projectLegacyCode: null,
        projectRecordType: null,
        error: "project_id_not_found",
      };
    }
    return buildContext(projectRead.row);
  }

  if (input.propertyLegacyCode) {
    const { data, error } = await client
      .schema("crm")
      .from("properties")
      .select(PROPERTY_CONTEXT_SELECT_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("legacy_code", input.propertyLegacyCode)
      .maybeSingle();
    if (error) {
      return {
        propertyId: null,
        propertyLegacyCode: null,
        propertyRecordType: null,
        projectId: null,
        projectLegacyCode: null,
        projectRecordType: null,
        error: `db_property_legacy_read_error:${error.message}`,
      };
    }
    if (!data) {
      return {
        propertyId: null,
        propertyLegacyCode: null,
        propertyRecordType: null,
        projectId: null,
        projectLegacyCode: null,
        projectRecordType: null,
        error: "property_legacy_code_not_found",
      };
    }
    return buildContext(data as Record<string, unknown>);
  }

  return {
    propertyId: null,
    propertyLegacyCode: null,
    propertyRecordType: null,
    projectId: null,
    projectLegacyCode: null,
    projectRecordType: null,
    error: null,
  };
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
    const convertedAt = asText(lead.converted_at);
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

    const status = convertedClientId || convertedAgencyId || convertedAt
      ? "converted"
      : normalizeLeadStatus(asText(lead.status), "new");
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
      assigned_to: asUuid(lead.assigned_to),
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
      converted_at: convertedAt,
      message: asText(mappedPayload.message) || asText((lead as any).message),
      property_code: propertyCode,
      property_label: propertyDisplayLabel,
      property_record_type: asText(propertyRow?.record_type),
      project_id: asUuid(projectRow?.id),
      project_code: projectCode,
      project_label: projectDisplay,
      import_source_file: asText(importPayload.source_file) ?? asText(importPayload.file_name) ?? asText(importPayload.channel),
      import_source_row_number: asNumber(importPayload.row_number),
      created_at: asText(lead.created_at),
      updated_at: asText(lead.updated_at),
      search_blob: searchable,
    };
  });
};
