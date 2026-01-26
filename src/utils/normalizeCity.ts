export function normalizeCity(raw?: string | null): string | null {
  if (!raw) return null;

  return raw
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}
