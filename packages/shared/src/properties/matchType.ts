import { TYPES } from "@shared/data/properties/taxonomies";

export function matchType(rawType?: string | null): string | null {
  if (!rawType) return null;

  const value = rawType.toLowerCase();

  for (const [key, definition] of Object.entries(TYPES)) {
    if (definition.match.some((match) => match === value)) {
      return key;
    }
  }

  return null;
}
