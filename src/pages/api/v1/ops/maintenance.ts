import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import {
  CRM_MAINTENANCE_DEFAULT_MESSAGE,
  getCrmMaintenanceSnapshot,
  updateCrmMaintenanceEntry,
} from "@shared/crm/maintenance";

type MaintenanceUpdateInput = {
  enabled?: unknown;
  message?: unknown;
};

type MaintenanceRequestBody = {
  web?: MaintenanceUpdateInput;
  crm?: MaintenanceUpdateInput;
};

const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const readSecretToken = (): string | null => {
  const value = asText(import.meta.env.OPS_MAINTENANCE_TOKEN);
  return value && value.length >= 24 ? value : null;
};

const readProvidedToken = (request: Request): string | null => {
  const authorization = asText(request.headers.get("authorization"));
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return asText(authorization.slice(7));
  }

  const xOpsToken = asText(request.headers.get("x-ops-token"));
  if (xOpsToken) return xOpsToken;

  try {
    const url = new URL(request.url);
    return asText(url.searchParams.get("token"));
  } catch {
    return null;
  }
};

const notFound = () =>
  new Response("Not Found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
    },
  });

const isAuthorized = (request: Request): boolean => {
  const secret = readSecretToken();
  if (!secret) return false;
  const provided = readProvidedToken(request);
  return provided === secret;
};

const normalizeUpdate = (
  current: {
    enabled: boolean;
    message: string;
  },
  input: MaintenanceUpdateInput | undefined
) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const enabled = typeof input.enabled === "boolean" ? input.enabled : current.enabled;
  const message = asText(input.message) ?? current.message ?? CRM_MAINTENANCE_DEFAULT_MESSAGE;

  const hasEnabled = typeof input.enabled === "boolean";
  const hasMessage = asText(input.message) !== null;
  if (!hasEnabled && !hasMessage) return null;

  return {
    enabled,
    message,
  };
};

export const GET: APIRoute = async ({ request }) => {
  if (!isAuthorized(request)) return notFound();

  const snapshot = await getCrmMaintenanceSnapshot({
    forceRefresh: true,
  });

  return jsonResponse({
    ok: true,
    data: snapshot,
  });
};

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthorized(request)) return notFound();

  const current = await getCrmMaintenanceSnapshot({
    forceRefresh: true,
  });

  const body = await parseJsonBody<MaintenanceRequestBody>(request);
  if (!body) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_body",
      },
      { status: 400 }
    );
  }

  const webUpdate = normalizeUpdate(current.web, body.web);
  const crmUpdate = normalizeUpdate(current.crm, body.crm);

  if (!webUpdate && !crmUpdate) {
    return jsonResponse(
      {
        ok: false,
        error: "no_valid_updates",
      },
      { status: 400 }
    );
  }

  if (webUpdate) {
    await updateCrmMaintenanceEntry({
      area: "web",
      enabled: webUpdate.enabled,
      message: webUpdate.message,
    });
  }

  if (crmUpdate) {
    await updateCrmMaintenanceEntry({
      area: "crm",
      enabled: crmUpdate.enabled,
      message: crmUpdate.message,
    });
  }

  const snapshot = await getCrmMaintenanceSnapshot({
    forceRefresh: true,
  });

  return jsonResponse({
    ok: true,
    data: snapshot,
  });
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
