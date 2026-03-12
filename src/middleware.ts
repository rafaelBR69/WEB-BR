import { defineMiddleware } from "astro:middleware";
import { clearCrmAuthCookies, resolveCrmAuthFromCookies } from "@/utils/crmAuth";

const normalizePath = (pathname: string): string => {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized.length ? normalized : "/";
};

const isCrmPublicAuthPath = (pathname: string): boolean => {
  return pathname === "/crm/login" || pathname === "/crm/register";
};

const isCrmApiPath = (pathname: string): boolean => pathname.startsWith("/api/v1/crm");

const deploySurface = String(import.meta.env.APP_DEPLOY_SURFACE ?? "")
  .trim()
  .toLowerCase();

const isWebOnlyDeploy = deploySurface === "web";

const isApiPath = (pathname: string): boolean => pathname.startsWith("/api/");

const isWebAllowedApiPath = (pathname: string): boolean => {
  if (pathname === "/api/v1/health") return true;
  if (pathname === "/api/v1/leads") return true;
  return pathname.startsWith("/api/v1/portal/");
};

const isCrmApiPublicAuthPath = (pathname: string): boolean => {
  return pathname === "/api/v1/crm/auth/login" || pathname === "/api/v1/crm/auth/register";
};

const isStaticAssetRequest = (pathname: string): boolean => {
  const lastSegment = pathname.split("/").pop() ?? "";
  return /\.[a-z0-9]+$/i.test(lastSegment);
};

const notFoundResponse = (pathname: string) => {
  if (isApiPath(pathname)) {
    return new Response(
      JSON.stringify(
        {
          ok: false,
          error: "not_found",
        },
        null,
        2
      ),
      {
        status: 404,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      }
    );
  }

  return new Response("Not Found", { status: 404 });
};

const jsonAuthError = (status: number, error: string) =>
  new Response(
    JSON.stringify(
      {
        ok: false,
        error,
      },
      null,
      2
    ),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    }
  );

export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = normalizePath(context.url.pathname);
  if (isWebOnlyDeploy) {
    if (pathname === "/crm" || pathname.startsWith("/crm/")) {
      return notFoundResponse(pathname);
    }
    if (pathname.startsWith("/api/v1") && !isWebAllowedApiPath(pathname)) {
      return notFoundResponse(pathname);
    }
  }

  if (!pathname.startsWith("/crm") && !isCrmApiPath(pathname)) return next();
  if (isStaticAssetRequest(pathname)) return next();

  if (isCrmApiPath(pathname)) {
    if (isCrmApiPublicAuthPath(pathname)) return next();
    const auth = await resolveCrmAuthFromCookies(context.cookies);
    if (auth.ok) return next();
    clearCrmAuthCookies(context.cookies);
    return jsonAuthError(401, auth.error ?? "crm_auth_required");
  }

  if (isCrmPublicAuthPath(pathname)) {
    const auth = await resolveCrmAuthFromCookies(context.cookies);
    if (auth.ok) {
      return context.redirect("/crm/", 302);
    }
    return next();
  }

  const auth = await resolveCrmAuthFromCookies(context.cookies);
  if (auth.ok) return next();

  clearCrmAuthCookies(context.cookies);
  const loginUrl = new URL("/crm/login/", context.url.origin);
  loginUrl.searchParams.set("next", `${context.url.pathname}${context.url.search}`);
  return context.redirect(`${loginUrl.pathname}${loginUrl.search}`, 302);
});
