export function formatArea(
  m2: number | null | undefined,
  lang: string = "es"
): string | null {
  if (!m2 || m2 <= 0) return null;

  // En inmobiliaria europea NO se traduce a sqft salvo mercado USA
  return `${m2} m²`;
}

const ORIENTATION_LABELS: Record<string, Record<string, string>> = {
  north: { es: "Norte", en: "North", de: "Nord", fr: "Nord", it: "Nord", nl: "Noord" },
  south: { es: "Sur", en: "South", de: "Süd", fr: "Sud", it: "Sud", nl: "Zuid" },
  east:  { es: "Este", en: "East", de: "Ost", fr: "Est", it: "Est", nl: "Oost" },
  west:  { es: "Oeste", en: "West", de: "West", fr: "Ouest", it: "Ovest", nl: "West" },
};

export function formatOrientation(
  orientation?: string | null,
  lang: string = "es"
): string | null {
  if (!orientation) return null;

  return ORIENTATION_LABELS[orientation]?.[lang] ?? orientation;
}

const PROPERTY_TYPE_LABELS: Record<string, Record<string, string>> = {
  townhouse: {
    es: "Casa adosada",
    en: "Townhouse",
    de: "Reihenhaus",
    fr: "Maison mitoyenne",
    it: "Casa a schiera",
    nl: "Rijwoning",
  },
  detached_villa: {
    es: "Villa independiente",
    en: "Detached villa",
    de: "Freistehende Villa",
    fr: "Villa individuelle",
    it: "Villa indipendente",
    nl: "Vrijstaande villa",
  },
  apartment: {
    es: "Apartamento",
    en: "Apartment",
    de: "Wohnung",
    fr: "Appartement",
    it: "Appartamento",
    nl: "Appartement",
  },
};

export function formatPropertyType(
  type?: string | null,
  lang: string = "es"
): string | null {
  if (!type) return null;

  return PROPERTY_TYPE_LABELS[type]?.[lang] ?? displayLocation(type);
}

export function displayLocation(key: string | null | undefined): string {
  if (!key) return "";
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}
