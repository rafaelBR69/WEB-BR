export function normalizeArea(raw?: string | null): string | null {
  if (!raw) return null;

  const v = raw.toLowerCase();

  if (v.includes("cala")) return "la_cala_de_mijas";

  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}
