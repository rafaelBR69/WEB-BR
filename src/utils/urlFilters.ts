export function buildQueryUrl(basePath: string, currentSearch: string, removeKeys: string[]) {
  const sp = new URLSearchParams(currentSearch);

  for (const k of removeKeys) sp.delete(k);

  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

// Dependencias: si quito city, también quito area
export function removeDependencies(key: string): string[] {
  if (key === "city") return ["city", "area"];
  return [key];
}
