import type { APIRoute } from "astro";
import posts from "@shared/data/posts";
import teamMembers from "@shared/data/team";
import { SUPPORTED_LANGS } from "@shared/i18n/languages";
import { normalizeProperty, normalizePropertyCard, getPublicPropertiesWithFallback } from "@shared/properties/public";
import { evaluatePropertyLandingEligibility } from "@shared/seo/propertyLandingEligibility";

const SITE_URL = "https://blancareal.com";

const CORE_URLS = SUPPORTED_LANGS.flatMap((lang) => [
  `/${lang}/`,
  `/${lang}/properties/`,
  `/${lang}/legal-services/`,
  `/${lang}/commercialization/`,
  `/${lang}/sell-with-us/`,
  `/${lang}/agents/`,
  `/${lang}/contact/`,
  `/${lang}/projects/`,
]);

const POST_URLS = SUPPORTED_LANGS.flatMap((lang) => {
  const indexUrl = `/${lang}/posts/`;
  const detailUrls = posts
    .filter((post) => post.status === "published")
    .map((post) => post.slugs?.[lang] ?? post.slugs?.es ?? null)
    .filter(Boolean)
    .map((slug) => `/${lang}/post/${slug}/`);
  return [indexUrl, ...detailUrls];
});

const slugify = (value: string) =>
  String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

const AGENT_URLS = SUPPORTED_LANGS.flatMap((lang) => {
  return teamMembers.map((member) => {
    const slug = member.id ?? slugify(member.name ?? "");
    return `/${lang}/agents/${slug}/`;
  });
});

export const GET: APIRoute = async () => {
  const { properties } = await getPublicPropertiesWithFallback({
  });

  const landingUrls = SUPPORTED_LANGS.flatMap((lang) => {
    const cards = properties
      .map((property) => normalizePropertyCard(property, lang))
      .filter(Boolean)
      .filter((card) => card.visible);

    return evaluatePropertyLandingEligibility({ lang, cards })
      .filter((entry) => entry.showInSitemap)
      .map((entry) => entry.landing.canonicalPath);
  });

  const propertyUrls = SUPPORTED_LANGS.flatMap((lang) =>
    properties
      .map((property) => ({
        property,
        data: normalizeProperty(property, lang),
      }))
      .filter(({ property, data }) =>
        Boolean(property.slugs?.[lang]) &&
        Boolean(data) &&
        data.visible &&
        !data.seo.noindex
      )
      .map(({ property }) => `/${lang}/property/${property.slugs[lang]}/`)
  );

  const urls = Array.from(
    new Set([
      ...CORE_URLS,
      ...landingUrls,
      ...propertyUrls,
      ...POST_URLS,
      ...AGENT_URLS,
    ])
  );

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(
  (path) => `
  <url>
    <loc>${SITE_URL}${path}</loc>
  </url>`
).join("")}
</urlset>`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml",
    },
  });
};
