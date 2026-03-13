const asArray = (value: unknown) => (Array.isArray(value) ? value : []);

const hasMediaUrl = (value: unknown) =>
  typeof value === "string" ||
  (typeof value === "object" &&
    value !== null &&
    typeof (value as { url?: unknown }).url === "string" &&
    String((value as { url?: unknown }).url).trim().length > 0);

const isPdfUrl = (value: unknown) => {
  if (typeof value === "string") return value.toLowerCase().endsWith(".pdf");
  if (typeof value === "object" && value !== null) {
    const url = String((value as { url?: unknown }).url ?? "");
    return url.toLowerCase().endsWith(".pdf");
  }
  return false;
};

const getMediaUrl = (value: unknown) =>
  typeof value === "string" ? value : String((value as { url?: unknown })?.url ?? "");

export const resolvePrimaryMediaItem = (media: any) => {
  if (!media || typeof media !== "object") return null;

  const gallery = media.gallery ?? {};
  const candidates = [
    media.main,
    media.cover,
    ...asArray(gallery.exterior),
    ...asArray(gallery.interior),
    ...asArray(gallery.living),
    ...asArray(gallery.bedroom),
    ...asArray(gallery.kitchen),
    ...asArray(gallery.bathroom),
    ...asArray(gallery.views),
    ...asArray(gallery.floorplan),
  ];

  return candidates.find((item) => hasMediaUrl(item)) ?? null;
};

export const resolveMediaGalleryItems = (media: any, limit = 8) => {
  if (!media || typeof media !== "object") return [];

  const gallery = media.gallery ?? {};
  const candidates = [
    media.main,
    media.cover,
    ...asArray(gallery.exterior),
    ...asArray(gallery.interior),
    ...asArray(gallery.living),
    ...asArray(gallery.bedroom),
    ...asArray(gallery.kitchen),
    ...asArray(gallery.bathroom),
    ...asArray(gallery.views),
  ];

  const seen = new Set<string>();
  const items = [];

  for (const item of candidates) {
    if (!hasMediaUrl(item) || isPdfUrl(item)) continue;
    const url = getMediaUrl(item).trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    items.push(item);
    if (items.length >= limit) break;
  }

  return items;
};

export const resolvePrimaryMediaUrl = (media: any) => {
  const item = resolvePrimaryMediaItem(media);
  if (!item) return "";
  return typeof item === "string" ? item : String(item.url ?? "");
};
