import { defineMiddleware } from "astro:middleware";
import { clearCrmAuthCookies, resolveCrmAuthFromCookies } from "@shared/crm/auth";
import { createMaintenanceResponse, getCrmMaintenanceSnapshot } from "@shared/crm/maintenance";

const normalizePath = (pathname: string): string => {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized.length ? normalized : "/";
};

const isCrmPublicAuthPath = (pathname: string): boolean => {
  return pathname === "/crm/login" || pathname === "/crm/register";
};

const isCrmApiPath = (pathname: string): boolean => pathname.startsWith("/api/v1/crm");
const isHealthApiPath = (pathname: string): boolean => pathname === "/api/v1/health";
const isCrmAuthApiPath = (pathname: string): boolean => pathname.startsWith("/api/v1/crm/auth/");
const isPrivateOpsMaintenancePath = (pathname: string): boolean => pathname === "/api/v1/ops/maintenance";

const deploySurface = String(import.meta.env.APP_DEPLOY_SURFACE ?? "")
  .trim()
  .toLowerCase();

const isWebOnlyDeploy = deploySurface === "web";
const isCrmOnlyDeploy = deploySurface === "crm";

const isApiPath = (pathname: string): boolean => pathname.startsWith("/api/");

const isWebAllowedApiPath = (pathname: string): boolean => {
  if (pathname === "/api/v1/health") return true;
  if (isPrivateOpsMaintenancePath(pathname)) return true;
  if (pathname === "/api/v1/leads") return true;
  return pathname.startsWith("/api/v1/portal/");
};

const isCrmAllowedApiPath = (pathname: string): boolean => {
  if (pathname === "/api/v1/health") return true;
  if (isPrivateOpsMaintenancePath(pathname)) return true;
  return pathname.startsWith("/api/v1/crm/");
};

const isCrmApiPublicAuthPath = (pathname: string): boolean => {
  return pathname === "/api/v1/crm/auth/login" || pathname === "/api/v1/crm/auth/register";
};

const isCrmMaintenanceBypassPath = (pathname: string): boolean => {
  if (isHealthApiPath(pathname)) return true;
  if (isPrivateOpsMaintenancePath(pathname)) return true;
  if (isCrmPublicAuthPath(pathname)) return true;
  if (isCrmAuthApiPath(pathname)) return true;
  return false;
};

const isStaticAssetRequest = (pathname: string): boolean => {
  const lastSegment = pathname.split("/").pop() ?? "";
  return /\.[a-z0-9]+$/i.test(lastSegment);
};

const isWebMaintenanceTargetPath = (pathname: string): boolean => {
  if (isPrivateOpsMaintenancePath(pathname)) return false;
  if (pathname.startsWith("/crm")) return false;
  if (isCrmApiPath(pathname)) return false;
  return true;
};

const isCrmMaintenanceTargetPath = (pathname: string): boolean => {
  return pathname === "/crm" || pathname.startsWith("/crm/") || isCrmApiPath(pathname);
};

const acceptsJsonResponse = (request: Request, pathname: string): boolean => {
  if (isApiPath(pathname)) return true;
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("application/json");
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

  if (isCrmOnlyDeploy) {
    if (pathname === "/") {
      return context.redirect("/crm/", 302);
    }
    if (pathname.startsWith("/api/v1") && !isCrmAllowedApiPath(pathname)) {
      return notFoundResponse(pathname);
    }
    if (
      !pathname.startsWith("/crm") &&
      !isCrmApiPath(pathname) &&
      !isPrivateOpsMaintenancePath(pathname) &&
      !isStaticAssetRequest(pathname)
    ) {
      return notFoundResponse(pathname);
    }
  }

  if (isStaticAssetRequest(pathname)) return next();

  const maintenanceSnapshot = isHealthApiPath(pathname)
    ? null
    : await getCrmMaintenanceSnapshot();

  if (maintenanceSnapshot?.web.enabled && isWebMaintenanceTargetPath(pathname)) {
    return createMaintenanceResponse({
      area: "web",
      pathname,
      acceptsJson: acceptsJsonResponse(context.request, pathname),
      message: maintenanceSnapshot.web.message,
    });
  }

  if (
    maintenanceSnapshot?.crm.enabled &&
    isCrmMaintenanceTargetPath(pathname) &&
    !isCrmMaintenanceBypassPath(pathname)
  ) {
    return createMaintenanceResponse({
      area: "crm",
      pathname,
      acceptsJson: acceptsJsonResponse(context.request, pathname),
      message: maintenanceSnapshot.crm.message,
    });
  }

  if (!pathname.startsWith("/crm") && !isCrmApiPath(pathname)) return next();

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
