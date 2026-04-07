export const SESSION_KEY = "portal.session.v1";

export const toText = (value) => {
  const normalized = String(value ?? "").trim();
  return normalized.length ? normalized : null;
};

export const toNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

export const asObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
};

export const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const PORTAL_MEDIA_KEYS = ["exterior", "interior", "living", "bedroom", "kitchen", "bathroom", "views", "floorplan"];

const isPdfMediaUrl = (value) => {
  const text = toText(value);
  return Boolean(text && text.toLowerCase().endsWith(".pdf"));
};

const toMediaItem = (value) => {
  if (typeof value === "string") {
    const url = toText(value);
    if (!url || isPdfMediaUrl(url)) return null;
    return { url, label: null, alt: {} };
  }

  const row = asObject(value);
  const url = toText(row.url);
  if (!url || isPdfMediaUrl(url)) return null;
  return {
    url,
    label: toText(row.label),
    alt: asObject(row.alt),
  };
};

export const getPortalMediaCover = (media) => {
  const model = asObject(media);
  return toMediaItem(model.cover) ?? toMediaItem(model.main) ?? null;
};

export const getPortalMediaItems = (media, limit = 12) => {
  const model = asObject(media);
  const gallery = asObject(model.gallery);
  const candidates = [model.cover, model.main];

  PORTAL_MEDIA_KEYS.forEach((key) => {
    const rows = Array.isArray(gallery[key]) ? gallery[key] : [];
    candidates.push(...rows);
  });

  const seen = new Set();
  const items = [];

  for (const candidate of candidates) {
    const item = toMediaItem(candidate);
    if (!item) continue;
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    items.push(item);
    if (items.length >= limit) break;
  }

  return items;
};

export const getPortalMediaAlt = (item, lang = "es", fallback = "Portal image") => {
  const mediaItem = asObject(item);
  const altMap = asObject(mediaItem.alt);
  return (
    toText(altMap[lang]) ??
    toText(altMap.es) ??
    toText(altMap.en) ??
    toText(mediaItem.label) ??
    fallback
  );
};

export const getBootstrap = () => {
  const raw = asObject(window.__portalBootstrap);
  return {
    lang: toText(raw.lang) ?? "es",
    defaultOrganizationId: toText(raw.defaultOrganizationId) ?? "",
    projectId: toText(raw.projectId),
  };
};

export const portalPath = (lang, suffix) => {
  const safeLang = toText(lang) ?? "es";
  const normalizedSuffix = `/${String(suffix ?? "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")}/`;
  return `/${safeLang}${normalizedSuffix}`.replace(/\/{2,}/g, "/");
};

export const buildPortalApiUrl = (path, params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        const text = toText(entry);
        if (text) query.append(key, text);
      });
      return;
    }
    const text = toText(value);
    if (text) query.set(key, text);
  });

  const normalizedPath = `/${String(path ?? "").replace(/^\/+/, "")}`;
  const prefix = `/api/v1/portal${normalizedPath}`;
  const queryText = query.toString();
  return queryText ? `${prefix}?${queryText}` : prefix;
};

export const parseJsonSafe = (rawText) => {
  if (!rawText) return null;
  try {
    return JSON.parse(rawText);
  } catch {
    return null;
  }
};

export const requestJson = async (url, init = {}) => {
  const response = await fetch(url, init);
  const raw = await response.text();
  const payload = parseJsonSafe(raw);
  if (!response.ok || !payload?.ok) {
    const errorCode = toText(payload?.error) ?? `http_${response.status}`;
    const details =
      toText(payload?.details) ??
      toText(payload?.message) ??
      (toText(raw) ? String(raw).slice(0, 220) : null);
    const error = new Error(details ? `${errorCode}: ${details}` : errorCode);
    error.code = errorCode;
    throw error;
  }
  return payload;
};

const normalizeExpiresAt = (value) => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return null;
};

const normalizeSession = (parsed) => {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const accessToken = toText(parsed.accessToken ?? parsed.access_token);
  const refreshToken = toText(parsed.refreshToken ?? parsed.refresh_token);
  const tokenType = toText(parsed.tokenType ?? parsed.token_type) ?? "bearer";
  const expiresAt = normalizeExpiresAt(parsed.expiresAt ?? parsed.expires_at);
  const expiresIn = toNumber(parsed.expiresIn ?? parsed.expires_in);
  const organizationId =
    toText(parsed.organizationId ?? parsed.organization_id) ??
    toText(parsed.portalAccount?.organization_id);
  const portalAccountId =
    toText(parsed.portalAccountId ?? parsed.portal_account_id) ?? toText(parsed.portalAccount?.id);
  const role = toText(parsed.role ?? parsed.portalAccount?.role);
  const email =
    toText(parsed.email) ?? toText(parsed.authUser?.email) ?? toText(parsed.portalAccount?.metadata?.email);
  const authUserId = toText(parsed.authUserId ?? parsed.auth_user_id ?? parsed.authUser?.id);
  const updatedAt = toText(parsed.updatedAt ?? parsed.updated_at);

  return {
    accessToken,
    refreshToken,
    tokenType,
    expiresAt,
    expiresIn,
    organizationId,
    portalAccountId,
    role,
    email,
    authUserId,
    updatedAt,
  };
};

const readSessionFromStorage = (storage) => {
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return null;
    return normalizeSession(parseJsonSafe(raw));
  } catch {
    return null;
  }
};

export const loadSession = () => {
  const fromLocal = readSessionFromStorage(window.localStorage);
  if (fromLocal) return fromLocal;
  return readSessionFromStorage(window.sessionStorage);
};

export const isSessionAuthenticated = (session) => Boolean(toText(session?.accessToken));

export const isSessionExpired = (session, graceMs = 30000) => {
  const expiresAt = normalizeExpiresAt(session?.expiresAt);
  if (!expiresAt) return false;
  return Date.now() + graceMs >= expiresAt * 1000;
};

export const saveSession = (session, options = {}) => {
  const remember = options.remember !== false;
  try {
    window.localStorage.removeItem(SESSION_KEY);
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // no-op
  }

  const payload = {
    accessToken: toText(session?.accessToken),
    refreshToken: toText(session?.refreshToken),
    tokenType: toText(session?.tokenType) ?? "bearer",
    expiresAt: normalizeExpiresAt(session?.expiresAt),
    expiresIn: toNumber(session?.expiresIn),
    organizationId: toText(session?.organizationId),
    portalAccountId: toText(session?.portalAccountId),
    role: toText(session?.role),
    email: toText(session?.email),
    authUserId: toText(session?.authUserId),
    updatedAt: new Date().toISOString(),
  };

  if (!payload.accessToken) return null;
  if (remember) {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  } else {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  }
  return payload;
};

const isSessionPersistedInLocalStorage = () => {
  try {
    return Boolean(window.localStorage.getItem(SESSION_KEY));
  } catch {
    return false;
  }
};

export const withSessionOrganization = (params = {}, session = null) => {
  const nextParams = { ...params };
  const hasOrganizationId = toText(nextParams.organization_id);
  if (hasOrganizationId) return nextParams;

  const sessionOrganizationId = toText(session?.organizationId);
  if (sessionOrganizationId) {
    nextParams.organization_id = sessionOrganizationId;
  }
  return nextParams;
};

export const refreshPortalSession = async (session) => {
  const refreshToken = toText(session?.refreshToken);
  if (!refreshToken) return null;

  const organizationId = toText(session?.organizationId);
  const body = {
    refresh_token: refreshToken,
    ...(organizationId ? { organization_id: organizationId } : {}),
  };

  try {
    const payload = await requestJson(buildPortalApiUrl("/auth/refresh"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const portalAccount = asObject(payload?.data?.portal_account);
    const authUser = asObject(payload?.data?.auth_user);
    const authSession = asObject(payload?.data?.session);

    const remember = (() => {
      if (isSessionPersistedInLocalStorage()) return true;
      try {
        return !window.sessionStorage.getItem(SESSION_KEY);
      } catch {
        return true;
      }
    })();
    return saveSession(
      {
        accessToken: toText(authSession.access_token),
        refreshToken: toText(authSession.refresh_token) ?? refreshToken,
        tokenType: toText(authSession.token_type),
        expiresAt: authSession.expires_at,
        expiresIn: authSession.expires_in,
        organizationId: toText(portalAccount.organization_id) ?? organizationId,
        portalAccountId: toText(portalAccount.id) ?? toText(session?.portalAccountId),
        role: toText(portalAccount.role) ?? toText(session?.role),
        email: toText(authUser.email) ?? toText(session?.email),
        authUserId: toText(authUser.id) ?? toText(session?.authUserId),
      },
      { remember }
    );
  } catch {
    return null;
  }
};

export const clearSession = () => {
  window.localStorage.removeItem(SESSION_KEY);
  window.sessionStorage.removeItem(SESSION_KEY);
};

export const buildPortalAuthHeaders = (session, headers = {}) => {
  const authToken = toText(session?.accessToken);
  if (!authToken) return { ...headers };
  const tokenType = (toText(session?.tokenType) ?? "bearer").replace(/\s+/g, " ");
  return {
    ...headers,
    Authorization: `${tokenType} ${authToken}`.trim(),
  };
};

export const isPortalAuthErrorCode = (code) => {
  const normalized = toText(code) ?? "";
  return (
    normalized === "auth_token_required" ||
    normalized === "invalid_auth_token" ||
    normalized === "portal_account_not_found" ||
    normalized === "portal_account_not_active"
  );
};

export const roleLabel = (role, lang = "es") => {
  const labels = {
    portal_agent_admin: {
      es: "Agente admin",
      en: "Agent admin",
    },
    portal_agent_member: {
      es: "Agente miembro",
      en: "Agent member",
    },
    portal_client: {
      es: "Cliente portal",
      en: "Portal client",
    },
  };
  const normalized = toText(role) ?? "";
  const item = labels[normalized];
  if (!item) return normalized || "-";
  return item[lang] ?? item.en;
};

export const statusLabel = (status, lang = "es") => {
  const map = {
    active: { es: "Activo", en: "Active" },
    pending: { es: "Pendiente", en: "Pending" },
    pending_review: { es: "Revision", en: "Review" },
    attributed: { es: "Atribuido", en: "Attributed" },
    rejected_duplicate: { es: "Duplicado", en: "Duplicate" },
    manual_review: { es: "Manual", en: "Manual" },
    existing_client: { es: "Cliente existente", en: "Existing client" },
    requested: { es: "Solicitada", en: "Requested" },
    confirmed: { es: "Confirmada", en: "Confirmed" },
    declined: { es: "Rechazada", en: "Declined" },
    done: { es: "Realizada", en: "Done" },
    no_show: { es: "No show", en: "No show" },
    cancelled: { es: "Cancelada", en: "Cancelled" },
    approved: { es: "Aprobada", en: "Approved" },
    paid: { es: "Pagada", en: "Paid" },
    cancelled_commission: { es: "Cancelada", en: "Cancelled" },
    blocked: { es: "Bloqueada", en: "Blocked" },
    revoked: { es: "Revocada", en: "Revoked" },
    used: { es: "Usada", en: "Used" },
  };
  const normalized = toText(status) ?? "";
  const hit = map[normalized];
  if (hit) return hit[lang] ?? hit.en;
  return normalized || "-";
};

export const statusBadgeClass = (status) => {
  const normalized = toText(status) ?? "";
  const okSet = new Set(["active", "attributed", "confirmed", "done", "approved", "paid", "used"]);
  const warnSet = new Set(["pending", "pending_review", "requested", "manual_review", "existing_client"]);
  const dangerSet = new Set(["rejected_duplicate", "declined", "no_show", "cancelled", "blocked", "revoked"]);
  if (okSet.has(normalized)) return "ok";
  if (warnSet.has(normalized)) return "warn";
  if (dangerSet.has(normalized)) return "danger";
  return "warn";
};

export const formatDateTime = (value, locale = "es-ES") => {
  const text = toText(value);
  if (!text) return "-";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const formatDateOnly = (value, locale = "es-ES") => {
  const text = toText(value);
  if (!text) return "-";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

export const formatCurrency = (value, currency = "EUR", locale = "es-ES") => {
  const amount = toNumber(value);
  if (amount == null) return "-";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
};

export const pickProjectTitle = (project, lang = "es") => {
  const row = asObject(project);
  const translations = asObject(row.translations);
  const current = asObject(translations[lang]);
  const english = asObject(translations.en);
  const spanish = asObject(translations.es);

  return (
    toText(current.title) ??
    toText(current.name) ??
    toText(english.title) ??
    toText(english.name) ??
    toText(spanish.title) ??
    toText(spanish.name) ??
    toText(row.legacy_code) ??
    toText(row.id) ??
    "Proyecto"
  );
};

export const humanizeKey = (value) => {
  const text = toText(value);
  if (!text) return "-";
  return text
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (match) => match.toUpperCase());
};

export const truncate = (value, max = 180) => {
  const text = toText(value);
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 3))}...`;
};
