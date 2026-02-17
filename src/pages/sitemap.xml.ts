import type { APIRoute } from "astro";

const SITE_URL = "https://blancareal.com";

const URLS = [
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
