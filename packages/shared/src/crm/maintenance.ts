import { getSupabaseServerClient } from "@shared/supabase/server";

export const CRM_MAINTENANCE_DEFAULT_MESSAGE =
  "Estamos realizando ajustes y configuraciones. Vuelve en unos minutos.";

export const CRM_MAINTENANCE_AREAS = ["web", "crm"] as const;
export type CrmMaintenanceArea = (typeof CRM_MAINTENANCE_AREAS)[number];

export type CrmMaintenanceEntry = {
  area: CrmMaintenanceArea;
  enabled: boolean;
  message: string;
  updated_at: string | null;
  updated_by: string | null;
};

export type CrmMaintenanceSnapshot = Record<CrmMaintenanceArea, CrmMaintenanceEntry>;

type RuntimeSettingsRow = {
  setting_key: string;
  setting_value: unknown;
  updated_at: string | null;
  updated_by: string | null;
};

const CACHE_TTL_MS = 5_000;
const SETTING_KEY_BY_AREA: Record<CrmMaintenanceArea, string> = {
  web: "maintenance.web",
  crm: "maintenance.crm",
};

let cachedSnapshot: CrmMaintenanceSnapshot | null = null;
let cachedSnapshotAt = 0;

const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const asBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  return null;
};

const isCrmMaintenanceArea = (value: unknown): value is CrmMaintenanceArea =>
  value === "web" || value === "crm";

const createDefaultEntry = (area: CrmMaintenanceArea): CrmMaintenanceEntry => ({
  area,
  enabled: false,
  message: CRM_MAINTENANCE_DEFAULT_MESSAGE,
  updated_at: null,
  updated_by: null,
});

const createDefaultSnapshot = (): CrmMaintenanceSnapshot => ({
  web: createDefaultEntry("web"),
  crm: createDefaultEntry("crm"),
});

const normalizeRuntimeSettingsRow = (row: RuntimeSettingsRow | null | undefined): CrmMaintenanceEntry | null => {
  if (!row) return null;

  const area = Object.entries(SETTING_KEY_BY_AREA).find(([, key]) => key === row.setting_key)?.[0];
  if (!isCrmMaintenanceArea(area)) return null;

  const value = asObject(row.setting_value);
  return {
    area,
    enabled: asBoolean(value.enabled) ?? false,
    message: asText(value.message) ?? CRM_MAINTENANCE_DEFAULT_MESSAGE,
    updated_at: asText(row.updated_at),
    updated_by: asText(row.updated_by),
  };
};

export const getCrmMaintenanceSnapshot = async (
  options: {
    forceRefresh?: boolean;
  } = {}
): Promise<CrmMaintenanceSnapshot> => {
  const forceRefresh = options.forceRefresh === true;
  const now = Date.now();

  if (!forceRefresh && cachedSnapshot && now - cachedSnapshotAt < CACHE_TTL_MS) {
    return cachedSnapshot;
  }

  const client = getSupabaseServerClient();
  if (!client) {
    const fallback = createDefaultSnapshot();
    cachedSnapshot = fallback;
    cachedSnapshotAt = now;
    return fallback;
  }

  const { data, error } = await client
    .schema("crm")
    .from("runtime_settings")
    .select("setting_key, setting_value, updated_at, updated_by")
    .in("setting_key", Object.values(SETTING_KEY_BY_AREA));

  if (error) {
    const fallback = cachedSnapshot ?? createDefaultSnapshot();
    cachedSnapshot = fallback;
    cachedSnapshotAt = now;
    return fallback;
  }

  const snapshot = createDefaultSnapshot();
  (data ?? []).forEach((row) => {
    const normalized = normalizeRuntimeSettingsRow(row as RuntimeSettingsRow);
    if (!normalized) return;
    snapshot[normalized.area] = normalized;
  });

  cachedSnapshot = snapshot;
  cachedSnapshotAt = now;
  return snapshot;
};

export const updateCrmMaintenanceEntry = async (params: {
  area: CrmMaintenanceArea;
  enabled: boolean;
  message?: string | null;
  updatedBy?: string | null;
}): Promise<CrmMaintenanceEntry> => {
  const client = getSupabaseServerClient();
  if (!client) {
    throw new Error("supabase_not_configured");
  }

  const payload = {
    setting_key: SETTING_KEY_BY_AREA[params.area],
    setting_value: {
      enabled: params.enabled,
      message: asText(params.message) ?? CRM_MAINTENANCE_DEFAULT_MESSAGE,
    },
    updated_by: asText(params.updatedBy),
  };

  const { data, error } = await client
    .schema("crm")
    .from("runtime_settings")
    .upsert(payload, { onConflict: "setting_key" })
    .select("setting_key, setting_value, updated_at, updated_by")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  cachedSnapshot = null;
  cachedSnapshotAt = 0;

  const normalized = normalizeRuntimeSettingsRow(data as RuntimeSettingsRow | null);
  if (!normalized) {
    throw new Error("invalid_runtime_settings_row");
  }

  return normalized;
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const createMaintenanceResponse = (params: {
  area: CrmMaintenanceArea;
  pathname: string;
  acceptsJson?: boolean;
  message?: string | null;
}): Response => {
  const message = asText(params.message) ?? CRM_MAINTENANCE_DEFAULT_MESSAGE;
  const title =
    params.area === "crm" ? "CRM temporalmente en mantenimiento" : "Web temporalmente en mantenimiento";
  const areaLabel = params.area === "crm" ? "CRM" : "WEB";

  if (params.acceptsJson) {
    return new Response(
      JSON.stringify(
        {
          ok: false,
          error: "maintenance_mode",
          area: params.area,
          message,
          pathname: params.pathname,
        },
        null,
        2
      ),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Retry-After": "300",
        },
      }
    );
  }

  const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg-a: #f6f1e8;
        --bg-b: #ebe3d8;
        --panel: rgba(255, 252, 247, 0.9);
        --text: #1c1a17;
        --muted: #645f57;
        --line: rgba(28, 26, 23, 0.12);
        --accent: #9e4b21;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Segoe UI", system-ui, sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(158, 75, 33, 0.18), transparent 40%),
          linear-gradient(135deg, var(--bg-a), var(--bg-b));
        display: grid;
        place-items: center;
        padding: 24px;
      }
      main {
        width: min(680px, 100%);
        border: 1px solid var(--line);
        border-radius: 24px;
        background: var(--panel);
        backdrop-filter: blur(8px);
        padding: 32px;
        box-shadow: 0 24px 60px rgba(28, 26, 23, 0.12);
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 8px 14px;
        font-size: 12px;
        letter-spacing: 0.14em;
        color: var(--muted);
      }
      h1 {
        margin: 18px 0 12px;
        font-size: clamp(2rem, 6vw, 3.4rem);
        line-height: 0.96;
      }
      p {
        margin: 0;
        font-size: 1.05rem;
        line-height: 1.65;
        color: var(--muted);
      }
      .note {
        margin-top: 18px;
        padding-top: 18px;
        border-top: 1px solid var(--line);
        font-size: 0.95rem;
      }
      strong {
        color: var(--accent);
      }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">${escapeHtml(areaLabel)} • AJUSTES EN CURSO</div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <p class="note">Si necesitas acceso urgente, vuelve a intentarlo en unos minutos.</p>
    </main>
  </body>
</html>`;

  return new Response(html, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Retry-After": "300",
    },
  });
};
