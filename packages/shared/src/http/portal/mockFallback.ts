import { jsonResponse } from "@shared/api/json";

export const isPortalMockFallbackEnabled = () =>
  ["1", "true", "yes", "on"].includes(
    String(import.meta.env.CRM_ENABLE_MOCK_FALLBACKS ?? "").trim().toLowerCase()
  );

export const portalMockFallbackDisabledResponse = (error: string, details: string) =>
  jsonResponse(
    {
      ok: false,
      error,
      details,
    },
    { status: 501 }
  );
