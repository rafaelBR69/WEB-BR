import type { APIRoute } from "astro";
import { buildUrlSetResponse, getPropertyLandingSitemapEntries } from "./_shared";

export const GET: APIRoute = async () =>
  buildUrlSetResponse(await getPropertyLandingSitemapEntries());
