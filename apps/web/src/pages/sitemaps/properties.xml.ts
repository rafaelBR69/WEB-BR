import type { APIRoute } from "astro";
import { buildUrlSetResponse, getPropertySitemapEntries } from "./_shared";

export const GET: APIRoute = async () => buildUrlSetResponse(await getPropertySitemapEntries());
