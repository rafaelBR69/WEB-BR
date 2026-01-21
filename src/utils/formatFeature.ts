import { FEATURES } from "@/i18n/features";

export interface Feature {
  label: string;
  icon: string;
}

export function formatFeature(
  featureKey: string,
  lang: string
): Feature | null {
  const feature = (FEATURES as any)[featureKey];
  if (!feature) return null;

  return {
    label: feature[lang] ?? feature.es,
    icon: feature.icon,
  };
}
