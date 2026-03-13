import type { AstroCookies } from "astro";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseServerAuthClient } from "@shared/supabase/server";

export const CRM_ACCESS_TOKEN_COOKIE = "crm_access_token";
export const CRM_REFRESH_TOKEN_COOKIE = "crm_refresh_token";
export const CRM_EXPIRES_AT_COOKIE = "crm_expires_at";

export type CrmAuthResolution = {
  ok: boolean;
  user: User | null;
  session: Session | null;
  refreshed: boolean;
  error: string | null;
};

const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const getCookieValue = (cookies: AstroCookies, key: string): string | null => {
  return asText(cookies.get(key)?.value);
};

const getCookieBaseOptions = () => ({
  path: "/",
  secure: import.meta.env.PROD,
  sameSite: "lax" as const,
});

export const setCrmAuthCookies = (cookies: AstroCookies, session: Session) => {
  const accessToken = asText(session.access_token);
  const refreshToken = asText(session.refresh_token);
  if (!accessToken || !refreshToken) return;

  const accessTtl =
    Number.isFinite(session.expires_in) && session.expires_in > 0
      ? Math.floor(session.expires_in)
      : 3600;
  const refreshTtl = 60 * 60 * 24 * 30;
  const expiresAt =
    Number.isFinite(session.expires_at) && session.expires_at > 0
      ? Math.floor(session.expires_at)
      : null;

  cookies.set(CRM_ACCESS_TOKEN_COOKIE, accessToken, {
    ...getCookieBaseOptions(),
    httpOnly: true,
    maxAge: accessTtl,
  });
  cookies.set(CRM_REFRESH_TOKEN_COOKIE, refreshToken, {
    ...getCookieBaseOptions(),
    httpOnly: true,
    maxAge: refreshTtl,
  });
  cookies.set(CRM_EXPIRES_AT_COOKIE, expiresAt ? String(expiresAt) : "", {
    ...getCookieBaseOptions(),
    httpOnly: false,
    maxAge: refreshTtl,
  });
};

export const clearCrmAuthCookies = (cookies: AstroCookies) => {
  cookies.delete(CRM_ACCESS_TOKEN_COOKIE, { path: "/" });
  cookies.delete(CRM_REFRESH_TOKEN_COOKIE, { path: "/" });
  cookies.delete(CRM_EXPIRES_AT_COOKIE, { path: "/" });
};

export const resolveCrmAuthFromCookies = async (
  cookies: AstroCookies
): Promise<CrmAuthResolution> => {
  const authClient = getSupabaseServerAuthClient();
  if (!authClient) {
    return {
      ok: false,
      user: null,
      session: null,
      refreshed: false,
      error: "supabase_auth_not_configured",
    };
  }

  const accessToken = getCookieValue(cookies, CRM_ACCESS_TOKEN_COOKIE);
  if (!accessToken) {
    return {
      ok: false,
      user: null,
      session: null,
      refreshed: false,
      error: "auth_token_required",
    };
  }

  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
  if (!userError && userData?.user) {
    return {
      ok: true,
      user: userData.user,
      session: null,
      refreshed: false,
      error: null,
    };
  }

  const refreshToken = getCookieValue(cookies, CRM_REFRESH_TOKEN_COOKIE);
  if (!refreshToken) {
    clearCrmAuthCookies(cookies);
    return {
      ok: false,
      user: null,
      session: null,
      refreshed: false,
      error: "refresh_token_required",
    };
  }

  const { data: refreshData, error: refreshError } = await authClient.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (refreshError || !refreshData.session || !refreshData.user) {
    clearCrmAuthCookies(cookies);
    return {
      ok: false,
      user: null,
      session: null,
      refreshed: false,
      error: "invalid_refresh_token",
    };
  }

  setCrmAuthCookies(cookies, refreshData.session);
  return {
    ok: true,
    user: refreshData.user,
    session: refreshData.session,
    refreshed: true,
    error: null,
  };
};

export const mapCrmUser = (user: User) => {
  const userMeta =
    user.user_metadata && typeof user.user_metadata === "object" && !Array.isArray(user.user_metadata)
      ? (user.user_metadata as Record<string, unknown>)
      : {};
  const appMeta =
    user.app_metadata && typeof user.app_metadata === "object" && !Array.isArray(user.app_metadata)
      ? (user.app_metadata as Record<string, unknown>)
      : {};

  const fullName =
    asText(userMeta.full_name) ??
    asText(userMeta.name) ??
    asText(userMeta.display_name) ??
    asText(user.email);
  const role = asText(userMeta.crm_role) ?? asText(appMeta.role) ?? "staff";

  return {
    id: asText(user.id),
    email: asText(user.email),
    full_name: fullName,
    role,
    last_sign_in_at: asText(user.last_sign_in_at),
    created_at: asText(user.created_at),
    updated_at: asText(user.updated_at),
  };
};
