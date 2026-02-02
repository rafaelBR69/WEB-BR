import { formatFeature } from "@/utils/formatFeature";
import { matchType } from "@/utils/matchType";
import { normalizeCity } from "@/utils/normalizeCity";
import { normalizeArea } from "@/utils/normalizeArea";

export function normalizePropertyCard(property, lang) {
  if (!property) return null;

  const t = property.translations?.[lang] ?? {};
  const raw = property.property ?? {};
  const location = property.location ?? {};

  const status = property.status ?? "available";
  const visible = status !== "private";

  const typeKey = matchType(raw.type); // 👉 clave canónica
  const cityKey = property.location?.city
    ? normalizeCity(property.location.city)
    : null;

  const marketKey = raw.market ?? null;

  const areaKey = location.area
    ? normalizeArea(location.area)
    : null;

  console.log(
    "RAW LOCATION:",
    property.location
  );

  const features = (property.features || [])
    .map((key) => formatFeature(key, lang))
    .filter(Boolean);

  return {
    status,
    visible,

    slug: property.slugs?.[lang],   // 👈 AÑADIR ESTO
    title: t.title ?? "",
    cover: property.media?.cover ?? null, // 👈 AÑADIR ESTO
    price: property.price ?? null,
    currency: property.currency ?? "EUR",

    typeKey,
    cityKey,
    marketKey,
    areaKey,

    details: {
      bedrooms: raw.bedrooms ?? null,
      bathrooms: raw.bathrooms ?? null,
      area_m2: raw.area_m2 ?? null,
      orientation: raw.orientation ?? null,
    },

    features,
  };
}
