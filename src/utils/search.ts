const DIACRITICS_REGEX = /[\u0300-\u036f]/g;
const NON_WORD_REGEX = /[^\p{L}\p{N}]+/gu;

export function normalizeSearchText(value: unknown): string {
  if (!value) return "";
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS_REGEX, "")
    .replace(NON_WORD_REGEX, " ")
    .trim();
}

export function buildSearchText(property: any): string {
  if (!property) return "";

  const translations = property.translations ?? {};
  const translationText = Object.values(translations)
    .map((entry: any) => {
      if (!entry) return "";
      const desc = Array.isArray(entry.description)
        ? entry.description.map((block: any) => block?.text ?? "").join(" ")
        : "";
      return [entry.title, entry.intro, desc].filter(Boolean).join(" ");
    })
    .join(" ");

  const location = property.location ?? {};
  const raw = property.property ?? {};

  return [
    translationText,
    location.country,
    location.province,
    location.city,
    location.area,
    raw.type,
    raw.floor_label,
    raw.market,
    property.listing_type,
    property.status,
    Array.isArray(property.features) ? property.features.join(" ") : "",
    property.id,
    property.parent_id,
    property.slugs ? Object.values(property.slugs).join(" ") : "",
  ]
    .filter(Boolean)
    .join(" ");
}
