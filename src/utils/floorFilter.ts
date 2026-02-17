const stripAccents = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const cleanSpaces = (value: string) => value.replace(/\s+/g, " ").trim();

const normalizeForMatch = (value: string) =>
  stripAccents(cleanSpaces(value)).toLowerCase();

export const isVillaFloorLabel = (value: unknown) =>
  typeof value === "string" && /^\s*villa\b/i.test(value);

export function normalizeFloorFilterLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = cleanSpaces(value);
  if (!cleaned) return null;

  const normalized = normalizeForMatch(cleaned);

  if (
    normalized === "planta baja" ||
    normalized === "baja" ||
    normalized === "bajo" ||
    normalized === "0" ||
    normalized === "planta 0" ||
    normalized === "p0" ||
    normalized === "ground floor"
  ) {
    return "Planta baja";
  }

  const plantaMatch = normalized.match(/^planta\s*(-?\d+)$/);
  if (plantaMatch) {
    const level = Number(plantaMatch[1]);
    if (Number.isFinite(level)) {
      if (level === 0) return "Planta baja";
      return `Planta ${level}`;
    }
  }

  if (normalized === "atico duplex" || normalized === "atico dúplex") {
    return "Atico duplex";
  }

  if (normalized === "atico" || normalized === "ático") {
    return "Atico";
  }

  return cleaned;
}

const getFloorSortScore = (value: string) => {
  const normalized = normalizeForMatch(value);

  if (normalized === "planta baja") return [0, 0, normalized];

  const plantaMatch = normalized.match(/^planta\s*(-?\d+)$/);
  if (plantaMatch) {
    const level = Number(plantaMatch[1]);
    if (Number.isFinite(level)) return [1, level, normalized];
  }

  if (normalized === "atico") return [2, 0, normalized];
  if (normalized === "atico duplex") return [3, 0, normalized];
  return [4, 0, normalized];
};

export function sortFloorFilterLabels(values: string[]): string[] {
  return [...values].sort((a, b) => {
    const [groupA, orderA, textA] = getFloorSortScore(a);
    const [groupB, orderB, textB] = getFloorSortScore(b);
    if (groupA !== groupB) return groupA - groupB;
    if (orderA !== orderB) return orderA - orderB;
    return textA.localeCompare(textB, "es");
  });
}

