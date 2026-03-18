export function normalizeArea(raw?: string | null): string | null {
  if (!raw) return null;

  const value = raw.toLowerCase();

  if (value.includes("cala")) return "la_cala_de_mijas";
  if (value.includes("lagunas")) return "las_lagunas_de_mijas";
  if (value.includes("torreblanca")) return "torreblanca";

  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}
