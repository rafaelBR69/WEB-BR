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

type MaintenancePatch = {
  web?: {
    enabled: boolean;
    message?: string | null;
  };
  crm?: {
    enabled: boolean;
    message?: string | null;
  };
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

const parseEnabledParam = (value: string | null): boolean | null => {
  const normalized = asText(value)?.toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "on", "enable", "enabled", "open", "up"].includes(normalized)) return true;
  if (["0", "false", "off", "disable", "disabled", "close", "down"].includes(normalized)) return false;
  return null;
};

const buildPatchFromSearchParams = (
  searchParams: URLSearchParams,
  current: Awaited<ReturnType<typeof getCrmMaintenanceSnapshot>>
): MaintenancePatch | null => {
  const webEnabled = parseEnabledParam(searchParams.get("web"));
  const crmEnabled = parseEnabledParam(searchParams.get("crm"));
  const message = asText(searchParams.get("message"));

  const patch: MaintenancePatch = {};

  if (webEnabled !== null) {
    patch.web = {
      enabled: webEnabled,
      message: message ?? current.web.message ?? CRM_MAINTENANCE_DEFAULT_MESSAGE,
    };
  }

  if (crmEnabled !== null) {
    patch.crm = {
      enabled: crmEnabled,
      message: message ?? current.crm.message ?? CRM_MAINTENANCE_DEFAULT_MESSAGE,
    };
  }

  return patch.web || patch.crm ? patch : null;
};

const applyPatch = async (patch: MaintenancePatch) => {
  if (patch.web) {
    await updateCrmMaintenanceEntry({
      area: "web",
      enabled: patch.web.enabled,
      message: patch.web.message,
    });
  }

  if (patch.crm) {
    await updateCrmMaintenanceEntry({
      area: "crm",
      enabled: patch.crm.enabled,
      message: patch.crm.message,
    });
  }
};

export const GET: APIRoute = async ({ request }) => {
  if (!isAuthorized(request)) return notFound();

  const current = await getCrmMaintenanceSnapshot({
    forceRefresh: true,
  });

  const url = new URL(request.url);
  const patch = buildPatchFromSearchParams(url.searchParams, current);

  if (patch) {
    await applyPatch(patch);
  }

  const snapshot = patch
    ? await getCrmMaintenanceSnapshot({
        forceRefresh: true,
      })
    : current;

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

  await applyPatch({
    ...(webUpdate
      ? {
          web: {
            enabled: webUpdate.enabled,
            message: webUpdate.message,
          },
        }
      : {}),
    ...(crmUpdate
      ? {
          crm: {
            enabled: crmUpdate.enabled,
            message: crmUpdate.message,
          },
        }
      : {}),
  });

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
