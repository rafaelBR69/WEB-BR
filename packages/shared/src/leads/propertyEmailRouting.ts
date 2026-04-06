const normalizeEmail = (value: string) => value.trim().toLowerCase();

const dedupeEmails = (values: string[]) =>
  Array.from(new Set(values.map(normalizeEmail).filter(Boolean)));

export const DEFAULT_PROPERTY_LEAD_RECIPIENTS = dedupeEmails(["sales@blancareal.com"]);

// Populate this map with legacy_code -> internal recipients.
export const PROPERTY_LEAD_RECIPIENTS: Record<string, string[]> = {
  PM0074: ["marcelo@blancareal.com", "sales@blancareal.com"],
  PM0079: ["marcelo@blancareal.com", "sales@blancareal.com"],
  PM0011: ["natascha@blancareal.com", "sales@blancareal.com"],
  A0452: ["sales@blancareal.com"],
  A044921: ["sales@blancareal.com"],
  A0449411: ["sales@blancareal.com"],
  A0449412: ["sales@blancareal.com"],
  A0449413: ["sales@blancareal.com"],
  A044942: ["sales@blancareal.com"],
  A044943: ["sales@blancareal.com"],
  PT0403: ["sales@blancareal.com"],
};

export const getConfiguredPropertyLeadRecipients = (legacyCode: string | null): string[] => {
  if (!legacyCode) return [];
  const raw = PROPERTY_LEAD_RECIPIENTS[legacyCode];
  return Array.isArray(raw) ? dedupeEmails(raw) : [];
};
