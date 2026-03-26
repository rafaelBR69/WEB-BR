import { asNumber, asText, asUuid } from "../portal/domain.ts";
import { getProjectNameFromRow, getPropertyDisplayNameFromRow } from "../properties/domain.ts";

export const DEAL_STAGES = [
  "qualification",
  "visit",
  "offer",
  "negotiation",
  "reservation",
  "contract",
  "won",
  "lost",
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

export const DEAL_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "lead_id",
  "client_id",
  "property_id",
  "title",
  "stage",
  "expected_close_date",
  "expected_value",
  "currency",
  "probability",
  "owner_id",
  "created_at",
  "updated_at",
].join(", ");

export const normalizeDealStage = (value: unknown, fallback: DealStage = "qualification"): DealStage => {
  const text = asText(value);
  if (!text) return fallback;
  return DEAL_STAGES.includes(text as DealStage) ? (text as DealStage) : fallback;
};

export const isDealTerminalStage = (value: unknown): boolean => {
  const stage = asText(value);
  return Boolean(stage && (stage === "won" || stage === "lost"));
};

const firstText = (...values: unknown[]) => {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return null;
};

export const buildDealTitle = (input: {
  lead?: Record<string, unknown> | null;
  client?: Record<string, unknown> | null;
  property?: Record<string, unknown> | null;
}) => {
  const personLabel =
    firstText(
      input.client?.full_name,
      input.client?.billing_name,
      input.lead?.full_name,
      input.client?.client_code,
      input.lead?.id
    ) ?? "Oportunidad";
  const propertyLabel =
    (input.property ? getPropertyDisplayNameFromRow(input.property) : null) ??
    (input.property ? getProjectNameFromRow(input.property) : null) ??
    firstText(input.property?.legacy_code);
  return propertyLabel ? `${personLabel} | ${propertyLabel}` : personLabel;
};

export const mapDealRow = (
  row: Record<string, unknown>,
  input: {
    lead?: Record<string, unknown> | null;
    client?: Record<string, unknown> | null;
    property?: Record<string, unknown> | null;
  } = {}
) => {
  const property = input.property ?? null;
  const propertyLabel =
    (property ? getPropertyDisplayNameFromRow(property) : null) ??
    (property ? getProjectNameFromRow(property) : null) ??
    firstText(property?.legacy_code);

  return {
    id: asUuid(row.id),
    organization_id: asUuid(row.organization_id),
    lead_id: asUuid(row.lead_id),
    client_id: asUuid(row.client_id),
    property_id: asUuid(row.property_id),
    title: firstText(row.title) ?? buildDealTitle(input),
    stage: normalizeDealStage(row.stage),
    expected_close_date: asText(row.expected_close_date),
    expected_value: asNumber(row.expected_value),
    currency: firstText(row.currency) ?? "EUR",
    probability: asNumber(row.probability),
    owner_id: asUuid(row.owner_id),
    created_at: asText(row.created_at),
    updated_at: asText(row.updated_at),
    is_terminal: isDealTerminalStage(row.stage),
    lead: input.lead
      ? {
          id: asUuid(input.lead.id),
          full_name: firstText(input.lead.full_name),
          status: firstText(input.lead.status),
        }
      : null,
    client: input.client
      ? {
          id: asUuid(input.client.id),
          full_name: firstText(input.client.full_name, input.client.billing_name),
          client_code: firstText(input.client.client_code),
          client_status: firstText(input.client.client_status),
        }
      : null,
    property: property
      ? {
          id: asUuid(property.id),
          legacy_code: firstText(property.legacy_code),
          display_name: propertyLabel,
          project_label: getProjectNameFromRow(property),
          record_type: firstText(property.record_type),
          status: firstText(property.status),
        }
      : null,
  };
};
