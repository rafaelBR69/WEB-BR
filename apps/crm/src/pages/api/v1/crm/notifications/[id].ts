import type { APIRoute, AstroCookies } from "astro";
import { jsonResponse, methodNotAllowed } from "@shared/api/json";
import { type CrmPermission, resolveCrmOrgAccess } from "@shared/crm/access";
import { NOTIFICATION_SELECT_COLUMNS, mapNotificationRow } from "@shared/notifications/domain";
import { isMissingNotificationOrchestrationColumnError } from "@shared/notifications/sync";
import { asText, asUuid } from "@shared/portal/domain";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@shared/supabase/server";

const resolveNotificationAccess = async (
  cookies: AstroCookies,
  organizationIdHint: string | null,
  requiredPermission: CrmPermission
) => {
  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint,
    allowedPermissions: [requiredPermission],
  });
  if (access.error || !access.data) {
    return {
      data: null,
      error: {
        status: access.error?.status ?? 401,
        error: access.error?.error ?? "auth_context_unresolved",
        details: access.error?.details,
      },
    };
  }

  return {
    data: {
      organizationId: access.data.organization_id,
    },
    error: null,
  };
};

export const GET: APIRoute = async ({ params, url, cookies }) => {
  const notificationId = asUuid(params.id);
  if (!notificationId) return jsonResponse({ ok: false, error: "notification_id_required" }, { status: 422 });

  const organizationIdHint = asText(url.searchParams.get("organization_id"));
  const access = await resolveNotificationAccess(cookies, organizationIdHint, "crm.notifications.read");
  if (access.error || !access.data) {
    return jsonResponse(
      {
        ok: false,
        error: access.error?.error ?? "auth_context_unresolved",
        details: access.error?.details,
      },
      { status: access.error?.status ?? 401 }
    );
  }

  if (!hasSupabaseServerClient()) {
    return jsonResponse(
      {
        ok: false,
        error: "notifications_backend_unavailable",
        details: "Supabase o la capa de notifications no estan disponibles en este entorno.",
      },
      { status: 503 }
    );
  }

  const client = getSupabaseServerClient();
  if (!client) {
    return jsonResponse(
      {
        ok: false,
        error: "notifications_backend_unavailable",
        details: "Supabase o la capa de notifications no estan disponibles en este entorno.",
      },
      { status: 503 }
    );
  }

  const { data, error } = await client
    .schema("crm")
    .from("notifications")
    .select(NOTIFICATION_SELECT_COLUMNS)
    .eq("organization_id", access.data.organizationId)
    .eq("id", notificationId)
    .single();

  if (error) {
    if (isMissingNotificationOrchestrationColumnError(error.message)) {
      return jsonResponse(
        {
          ok: false,
          error: "notifications_schema_incomplete",
          details: error.message,
        },
        { status: 503 }
      );
    }
    return jsonResponse(
      {
        ok: false,
        error: "db_notification_detail_read_error",
        details: error.message,
      },
      { status: error.code === "PGRST116" ? 404 : 500 }
    );
  }

  return jsonResponse({
    ok: true,
    data: mapNotificationRow((data ?? {}) as Record<string, unknown>),
    meta: {
      storage: "supabase.crm.notifications",
    },
  });
};

export const OPTIONS: APIRoute = async () => methodNotAllowed(["GET"]);
