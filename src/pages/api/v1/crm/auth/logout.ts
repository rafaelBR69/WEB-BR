import type { APIRoute } from "astro";
import { clearCrmAuthCookies } from "@/utils/crmAuth";
import { jsonResponse, methodNotAllowed } from "@/utils/crmApi";

export const POST: APIRoute = async ({ cookies }) => {
  clearCrmAuthCookies(cookies);
  return jsonResponse({
    ok: true,
    data: {
      logged_out: true,
    },
  });
};

export const GET: APIRoute = async () => methodNotAllowed(["POST"]);
export const PUT: APIRoute = async () => methodNotAllowed(["POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["POST"]);
