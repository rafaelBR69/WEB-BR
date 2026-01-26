import { TYPES } from "@/data/properties/taxonomies";

export function matchType(rawType?: string | null): string | null {
  if (!rawType) return null;

  const value = rawType.toLowerCase();

  for (const [key, def] of Object.entries(TYPES)) {
    if (def.match.some((m) => m === value)) {
      return key;
    }
  }

  return null;
}
