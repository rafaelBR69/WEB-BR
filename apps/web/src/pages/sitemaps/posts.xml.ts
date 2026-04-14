import type { APIRoute } from "astro";
import { buildUrlSetResponse, getPostSitemapEntries } from "./_shared";

export const GET: APIRoute = async () => buildUrlSetResponse(getPostSitemapEntries());
