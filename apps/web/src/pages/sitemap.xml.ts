import type { APIRoute } from "astro";
import { buildSitemapIndexResponse, SITEMAP_CHILD_PATHS } from "./sitemaps/_shared";

export const GET: APIRoute = async () => buildSitemapIndexResponse(SITEMAP_CHILD_PATHS);
