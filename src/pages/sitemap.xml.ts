import type { APIRoute } from "astro";
import posts from "@/data/posts";
import teamMembers from "@/data/team";
import { SUPPORTED_LANGS } from "@/i18n/languages";

const SITE_URL = "https://blancareal.com";

const CORE_URLS = SUPPORTED_LANGS.flatMap((lang) => [
  `/${lang}/`,
  `/${lang}/real-estate/`,
  `/${lang}/legal-services/`,
  `/${lang}/commercialization/`,
  `/${lang}/agents/`,
  `/${lang}/contact/`,
  `/${lang}/projects/`,
  `/${lang}/map/`,
]);

const STATIC_URLS = [
  // Ciudades
  "/es/properties/mijas/",
  "/es/properties/marbella/",
  "/es/properties/fuengirola/",

  // Zonas
  "/es/properties/mijas/la-cala/",
  "/es/properties/marbella/puerto-banus/",

  // Tipos
  "/es/properties/mijas/villas/",
  "/es/properties/marbella/apartments/",
];

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

const URLS = Array.from(new Set([...CORE_URLS, ...STATIC_URLS, ...POST_URLS, ...AGENT_URLS]));

export const GET: APIRoute = async () => {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${URLS.map(
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
