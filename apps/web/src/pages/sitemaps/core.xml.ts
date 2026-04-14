import type { APIRoute } from "astro";
import { buildUrlSetResponse, getCoreSitemapEntries } from "./_shared";

export const GET: APIRoute = async () => buildUrlSetResponse(getCoreSitemapEntries());
