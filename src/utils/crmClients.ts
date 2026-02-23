export type ClientType = "individual" | "company";
export type ClientStatus = "active" | "inactive" | "discarded" | "blacklisted";
export type ClientTaxIdType = "dni" | "nie" | "cif" | "passport" | "other";
export type ProviderType =
  | "developer"
  | "promoter"
  | "constructor"
  | "architect"
  | "agency"
  | "owner"
  | "other";
export type ProviderStatus = "active" | "inactive";
export type AgencyStatus = "active" | "inactive" | "discarded";
export type AgencyScope = "buyer" | "seller" | "rental" | "mixed";
export type ClientEntryChannel =
  | "website"
  | "agency"
  | "phone"
  | "whatsapp"
  | "email"
  | "provider"
  | "walkin"
  | "portal"
  | "other";

export type ClientProfileData = {
  intake_date: string | null;
  entry_channel: ClientEntryChannel;
  agency_name: string | null;
  agent_name: string | null;
  nationality: string | null;
  budget_amount: number | null;
  typology: string | null;
  preferred_location: string | null;
  comments: string | null;
  report_notes: string | null;
  visit_notes: string | null;
  reservation_notes: string | null;
  discarded_by: string | null;
  other_notes: string | null;
  tax_id_type: ClientTaxIdType | null;
  person_kind: "fisica" | "juridica" | null;
};

export const CLIENT_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "contact_id",
  "client_code",
  "client_type",
  "client_status",
  "billing_name",
  "tax_id",
  "billing_address",
  "profile_data",
  "created_at",
  "updated_at",
].join(", ");

export const CLIENT_SELECT_COLUMNS_LEGACY = [
  "id",
  "organization_id",
  "contact_id",
  "client_code",
  "client_type",
  "client_status",
  "billing_name",
  "tax_id",
  "billing_address",
  "created_at",
  "updated_at",
].join(", ");

export const CLIENT_CONTACT_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "full_name",
  "email",
  "phone",
].join(", ");

export const CLIENT_PROVIDER_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "client_id",
  "provider_code",
  "provider_type",
  "provider_status",
  "is_billable",
  "notes",
  "created_at",
  "updated_at",
].join(", ");

export const CLIENT_AGENCY_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "client_id",
  "agency_code",
  "agency_status",
  "agency_scope",
  "is_referral_source",
  "notes",
  "created_at",
  "updated_at",
].join(", ");

export type ClientRelationsInput = {
  provider?: Record<string, unknown> | null;
  agency?: Record<string, unknown> | null;
  isProviderForProject?: boolean;
};

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

export const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

export const asBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return null;
};

export const asDate = (value: unknown): string | null => {
  const text = asText(value);
  if (!text) return null;
  return DATE_RX.test(text) ? text : null;
};

export const isMissingProfileDataColumnError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  const code = String(row.code ?? "");
  const message = String(row.message ?? "").toLowerCase();
  const details = String(row.details ?? "").toLowerCase();

  if (code === "42703") {
    return message.includes("profile_data") || details.includes("profile_data");
  }

  return message.includes("profile_data") && message.includes("does not exist");
};

export const normalizeClientType = (value: unknown): ClientType =>
  value === "company" ? "company" : "individual";

export const normalizeClientStatus = (value: unknown): ClientStatus => {
  if (
    value === "active" ||
    value === "inactive" ||
    value === "discarded" ||
    value === "blacklisted"
  ) {
    return value;
  }
  return "active";
};

export const normalizeTaxIdType = (value: unknown): ClientTaxIdType | null => {
  if (
    value === "dni" ||
    value === "nie" ||
    value === "cif" ||
    value === "passport" ||
    value === "other"
  ) {
    return value;
  }
  return null;
};

export const normalizeEntryChannel = (value: unknown): ClientEntryChannel => {
  if (
    value === "website" ||
    value === "agency" ||
    value === "phone" ||
    value === "whatsapp" ||
    value === "email" ||
    value === "provider" ||
    value === "walkin" ||
    value === "portal" ||
    value === "other"
  ) {
    return value;
  }
  return "other";
};

export const normalizePersonKind = (value: unknown): "fisica" | "juridica" | null => {
  if (value === "fisica" || value === "juridica") return value;
  return null;
};

export const normalizeProviderType = (value: unknown): ProviderType => {
  if (
    value === "developer" ||
    value === "promoter" ||
    value === "constructor" ||
    value === "architect" ||
    value === "agency" ||
    value === "owner" ||
    value === "other"
  ) {
    return value;
  }
  return "other";
};

export const normalizeProviderStatus = (value: unknown): ProviderStatus => {
  if (value === "active" || value === "inactive") return value;
  return "active";
};

export const normalizeAgencyStatus = (value: unknown): AgencyStatus => {
  if (value === "active" || value === "inactive" || value === "discarded") return value;
  return "active";
};

export const normalizeAgencyScope = (value: unknown): AgencyScope => {
  if (value === "buyer" || value === "seller" || value === "rental" || value === "mixed") return value;
  return "mixed";
};

export const defaultPersonKindFromClientType = (clientType: ClientType): "fisica" | "juridica" =>
  clientType === "company" ? "juridica" : "fisica";

export const buildClientProfileData = (
  value: Partial<ClientProfileData> & Record<string, unknown>,
  fallbackClientType: ClientType
): ClientProfileData => {
  const source = asObject(value);
  const personKind =
    normalizePersonKind(source.person_kind) ?? defaultPersonKindFromClientType(fallbackClientType);

  return {
    intake_date: asDate(source.intake_date),
    entry_channel: normalizeEntryChannel(source.entry_channel),
    agency_name: asText(source.agency_name),
    agent_name: asText(source.agent_name),
    nationality: asText(source.nationality),
    budget_amount: asNumber(source.budget_amount),
    typology: asText(source.typology),
    preferred_location: asText(source.preferred_location),
    comments: asText(source.comments),
    report_notes: asText(source.report_notes),
    visit_notes: asText(source.visit_notes),
    reservation_notes: asText(source.reservation_notes),
    discarded_by: asText(source.discarded_by),
    other_notes: asText(source.other_notes),
    tax_id_type: normalizeTaxIdType(source.tax_id_type),
    person_kind: personKind,
  };
};

export const mapClientRow = (
  row: Record<string, unknown>,
  contactRow: Record<string, unknown> | null = null,
  relations: ClientRelationsInput = {}
) => {
  const clientType = normalizeClientType(row.client_type);
  const profile = buildClientProfileData(asObject(row.profile_data), clientType);
  const contact = asObject(contactRow);
  const provider = asObject(relations.provider);
  const agency = asObject(relations.agency);

  const providerId = asText(provider.id);
  const agencyId = asText(agency.id);
  const isProvider = Boolean(providerId);
  const isAgency = Boolean(agencyId);

  const fullName =
    asText(contact.full_name) ?? asText(row.billing_name) ?? asText(row.client_code) ?? "Cliente";
  const email = asText(contact.email);
  const phone = asText(contact.phone);

  return {
    id: asText(row.id),
    organization_id: asText(row.organization_id),
    contact_id: asText(row.contact_id),
    client_code: asText(row.client_code),
    client_type: clientType,
    client_status: normalizeClientStatus(row.client_status),
    full_name: fullName,
    email,
    phone,
    tax_id: asText(row.tax_id),
    tax_id_type: profile.tax_id_type,
    person_kind: profile.person_kind,
    intake_date: profile.intake_date,
    entry_channel: profile.entry_channel,
    agency_name: profile.agency_name,
    agent_name: profile.agent_name,
    nationality: profile.nationality,
    budget_amount: profile.budget_amount,
    typology: profile.typology,
    preferred_location: profile.preferred_location,
    comments: profile.comments,
    report_notes: profile.report_notes,
    visit_notes: profile.visit_notes,
    reservation_notes: profile.reservation_notes,
    discarded_by: profile.discarded_by,
    other_notes: profile.other_notes,
    is_provider: isProvider,
    provider_id: providerId,
    provider_code: asText(provider.provider_code),
    provider_type: isProvider ? normalizeProviderType(provider.provider_type) : null,
    provider_status: isProvider ? normalizeProviderStatus(provider.provider_status) : null,
    provider_is_billable: isProvider ? (asBoolean(provider.is_billable) ?? true) : null,
    provider_notes: asText(provider.notes),
    is_provider_for_project: isProvider ? Boolean(relations.isProviderForProject) : null,
    is_agency: isAgency,
    agency_id: agencyId,
    agency_code: asText(agency.agency_code),
    agency_scope: isAgency ? normalizeAgencyScope(agency.agency_scope) : null,
    agency_status: isAgency ? normalizeAgencyStatus(agency.agency_status) : null,
    agency_is_referral_source:
      isAgency ? (asBoolean(agency.is_referral_source) ?? true) : null,
    agency_notes: asText(agency.notes),
    created_at: asText(row.created_at),
    updated_at: asText(row.updated_at),
    profile_data: profile,
  };
};

export const getProfilePatchFromBody = (
  body: Record<string, unknown>
): Record<string, unknown> | null => {
  const patch: Record<string, unknown> = {};
  const keys = [
    "intake_date",
    "entry_channel",
    "agency_name",
    "agent_name",
    "nationality",
    "budget_amount",
    "typology",
    "preferred_location",
    "comments",
    "report_notes",
    "visit_notes",
    "reservation_notes",
    "discarded_by",
    "other_notes",
    "tax_id_type",
    "person_kind",
  ];

  keys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      patch[key] = body[key];
    }
  });

  return Object.keys(patch).length ? patch : null;
};
