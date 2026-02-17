import type { APIRoute } from "astro";
import posts from "@/data/posts";
import { SUPPORTED_LANGS } from "@/i18n/languages";

const SITE_URL = "https://blancareal.com";

const STATIC_URLS = [
  "/es/projects/",
  "/en/projects/",
  "/de/projects/",
  "/fr/projects/",
  "/it/projects/",
  "/nl/projects/",
  "/es/map/",
  "/en/map/",
  "/de/map/",
  "/fr/map/",
  "/it/map/",
  "/nl/map/",

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

const URLS = Array.from(new Set([...STATIC_URLS, ...POST_URLS]));

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
