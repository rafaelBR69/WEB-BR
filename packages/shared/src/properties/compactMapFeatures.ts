import { buildSupabaseImageUrl } from "@shared/media/supabaseImage";
import { resolvePrimaryMediaUrl } from "@shared/properties/resolvePropertyMedia";

const toFiniteNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveCoordinates = (property: any, parentProperty?: any | null) => {
  const ownLng = toFiniteNumber(property?.location?.coordinates?.lng);
  const ownLat = toFiniteNumber(property?.location?.coordinates?.lat);
  if (ownLng !== null && ownLat !== null) {
    return {
      coordinates: [ownLng, ownLat] as [number, number],
      source: "self" as const,
    };
  }

  const parentLng = toFiniteNumber(parentProperty?.location?.coordinates?.lng);
  const parentLat = toFiniteNumber(parentProperty?.location?.coordinates?.lat);
  if (parentLng !== null && parentLat !== null) {
    return {
      coordinates: [parentLng, parentLat] as [number, number],
      source: "parent" as const,
    };
  }

  return null;
};

const resolveSlug = (property: any, lang: string, card?: any) => {
  const cardSlug = typeof card?.slug === "string" ? card.slug.trim() : "";
  if (cardSlug) return cardSlug;

  const langSlug = typeof property?.slugs?.[lang] === "string" ? property.slugs[lang].trim() : "";
  if (langSlug) return langSlug;

  return typeof property?.slugs?.es === "string" ? property.slugs.es.trim() : "";
};

const resolveTitle = (property: any, lang: string, card?: any) =>
  String(
    card?.title ??
      property?.translations?.[lang]?.title ??
      property?.translations?.es?.title ??
      property?.id ??
      "Propiedad"
  ).trim();

const resolveRawCoverUrl = (property: any, parentProperty?: any | null, card?: any) => {
  const cardCover =
    typeof card?.cover === "string"
      ? card.cover.trim()
      : String(card?.cover?.url ?? "").trim();
  if (cardCover) return cardCover;

  const propertyCover = String(resolvePrimaryMediaUrl(property?.media) ?? "").trim();
  if (propertyCover) return propertyCover;

  return String(resolvePrimaryMediaUrl(parentProperty?.media) ?? "").trim();
};

const resolveLocationValue = (property: any, parentProperty: any | null | undefined, key: string) => {
  const ownValue = String(property?.location?.[key] ?? "").trim();
  if (ownValue) return ownValue;
  return String(parentProperty?.location?.[key] ?? "").trim();
};

const toFeatureCurrency = (property: any, card?: any) =>
  String(card?.currency ?? property?.currency ?? property?.pricing?.currency ?? "EUR").trim() || "EUR";

export type PropertyMapFeatureResult = {
  feature: Record<string, unknown> | null;
  reason: "missing_slug" | "missing_coordinates" | null;
  usedParentCoordinates: boolean;
};

export type CompactMapDiagnostics = {
  totalCards: number;
  renderedFeatures: number;
  byListingType: Record<string, number>;
  exclusions: {
    missingProperty: number;
    missingSlug: number;
    missingCoordinates: number;
  };
  fallbacks: {
    coordinatesFromParent: number;
  };
};

export function buildPropertyMapFeature({
  property,
  parentProperty = null,
  card = null,
  lang,
  availableUnitsCount = null,
}: {
  property: any;
  parentProperty?: any | null;
  card?: any | null;
  lang: string;
  availableUnitsCount?: number | null;
}): PropertyMapFeatureResult {
  const slug = resolveSlug(property, lang, card);
  if (!slug) {
    return {
      feature: null,
      reason: "missing_slug",
      usedParentCoordinates: false,
    };
  }

  const coordinates = resolveCoordinates(property, parentProperty);
  if (!coordinates) {
    return {
      feature: null,
      reason: "missing_coordinates",
      usedParentCoordinates: false,
    };
  }

  const rawCoverUrl = resolveRawCoverUrl(property, parentProperty, card);
  const listingType = String(card?.listingType ?? property?.listing_type ?? "unit").trim() || "unit";
  const title = resolveTitle(property, lang, card);
  const area = resolveLocationValue(property, parentProperty, "area");
  const city = resolveLocationValue(property, parentProperty, "city");
  const summaryPrice = card?.priceDisplay ?? card?.price ?? property?.pricing?.from ?? property?.price ?? "";
  const summaryBedrooms = card?.details?.bedrooms ?? property?.property?.bedrooms ?? "";
  const summaryArea = card?.details?.area_m2 ?? property?.property?.area_m2 ?? "";
  const coverUrl = rawCoverUrl
    ? buildSupabaseImageUrl(rawCoverUrl, { width: 360, quality: 70 })
    : "";

  return {
    reason: null,
    usedParentCoordinates: coordinates.source === "parent",
    feature: {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: coordinates.coordinates,
      },
      properties: {
        id: card?.id ?? property?.id ?? "",
        title,
        area,
        city,
        coverUrl,
        coverUrlFallback: rawCoverUrl,
        listingType,
        availableUnits:
          listingType === "promotion" && typeof availableUnitsCount === "number"
            ? availableUnitsCount
            : "",
        summaryPrice,
        summaryCurrency: toFeatureCurrency(property, card),
        summaryBedroomsMin: summaryBedrooms,
        summaryBedroomsMax: summaryBedrooms,
        summaryAreaMin: summaryArea,
        summaryAreaMax: summaryArea,
        href: `/${lang}/property/${slug}/`,
      },
    },
  };
}

export function buildCompactPropertyMapPayload(cards: any[], properties: any[], lang: string) {
  const propertyById = new Map(properties.map((property) => [String(property.id ?? ""), property]));
  const diagnostics: CompactMapDiagnostics = {
    totalCards: Array.isArray(cards) ? cards.length : 0,
    renderedFeatures: 0,
    byListingType: {},
    exclusions: {
      missingProperty: 0,
      missingSlug: 0,
      missingCoordinates: 0,
    },
    fallbacks: {
      coordinatesFromParent: 0,
    },
  };

  const features = (Array.isArray(cards) ? cards : [])
    .map((card) => {
      const property = propertyById.get(String(card?.id ?? ""));
      if (!property) {
        diagnostics.exclusions.missingProperty += 1;
        return null;
      }

      const parentProperty = property?.parent_id
        ? propertyById.get(String(property.parent_id)) ?? null
        : null;
      const listingType = String(card?.listingType ?? property?.listing_type ?? "unknown");
      diagnostics.byListingType[listingType] = (diagnostics.byListingType[listingType] ?? 0) + 1;

      const result = buildPropertyMapFeature({
        property,
        parentProperty,
        card,
        lang,
        availableUnitsCount:
          card?.isPromotion === true && typeof card?.availableUnitsCount === "number"
            ? card.availableUnitsCount
            : null,
      });

      if (result.reason === "missing_slug") {
        diagnostics.exclusions.missingSlug += 1;
        return null;
      }

      if (result.reason === "missing_coordinates") {
        diagnostics.exclusions.missingCoordinates += 1;
        return null;
      }

      if (result.usedParentCoordinates) {
        diagnostics.fallbacks.coordinatesFromParent += 1;
      }

      diagnostics.renderedFeatures += 1;
      return result.feature;
    })
    .filter((feature): feature is Record<string, unknown> => Boolean(feature));

  return {
    features,
    diagnostics,
  };
}

export function buildCompactPropertyMapFeatures(cards: any[], properties: any[], lang: string) {
  return buildCompactPropertyMapPayload(cards, properties, lang).features;
}
