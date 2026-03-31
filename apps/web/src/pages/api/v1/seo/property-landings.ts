import type { APIRoute } from "astro";
import { SUPPORTED_LANGS } from "@shared/i18n/languages";
import {
  getPublicPropertiesWithFallback,
  normalizePublicPropertyCards,
} from "@shared/properties/public";
import { evaluatePropertyLandingEligibility } from "@shared/seo/propertyLandingEligibility";

export const GET: APIRoute = async ({ url }) => {
  const requestedLang = String(url.searchParams.get("lang") ?? "").trim().toLowerCase();
  const langs = SUPPORTED_LANGS.includes(requestedLang as (typeof SUPPORTED_LANGS)[number])
    ? [requestedLang]
    : [...SUPPORTED_LANGS];

  const { properties, source } = await getPublicPropertiesWithFallback({
  });

  const report = langs.flatMap((lang) => {
    const cards = normalizePublicPropertyCards(properties, lang).filter((card) => card.visible);

    return evaluatePropertyLandingEligibility({
      lang,
      cards,
    }).map((entry) => ({
      lang,
      seoKey: entry.landing.seoKey,
      kind: entry.landing.kind,
      canonicalPath: entry.landing.canonicalPath,
      resultCount: entry.resultCount,
      minResults: entry.landing.minResults,
      isIndexable: entry.isIndexable,
      showInHub: entry.showInHub,
      showInSitemap: entry.showInSitemap,
      status: entry.status,
    }));
  });

  return new Response(
    JSON.stringify(
      {
        source,
        generatedAt: new Date().toISOString(),
        report,
      },
      null,
      2
    ),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    }
  );
};
