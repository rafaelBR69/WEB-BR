import { jsonResponse } from "@shared/api/json";

export const isClientsMockFallbackEnabled = () =>
  ["1", "true", "yes", "on"].includes(
    String(import.meta.env.CRM_ENABLE_MOCK_FALLBACKS ?? "").trim().toLowerCase()
  );

export const clientsMockFallbackDisabledResponse = (error: string, details: string) =>
  jsonResponse(
    {
      ok: false,
      error,
      details,
    },
    { status: 501 }
  );
