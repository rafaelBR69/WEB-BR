import type { APIRoute } from "astro";
import { buildUrlSetResponse, getAgentSitemapEntries } from "./_shared";

export const GET: APIRoute = async () => buildUrlSetResponse(getAgentSitemapEntries());
