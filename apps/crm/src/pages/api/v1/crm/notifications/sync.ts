import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { resolveCrmOrgAccess, CRM_ADMIN_ROLES } from "@shared/crm/access";
import { isMissingNotificationOrchestrationColumnError, syncNotificationsForOrganization } from "@shared/notifications/sync";
import { normalizeNotificationRuleKey } from "@shared/notifications/domain";
import { asText, toPositiveInt } from "@shared/portal/domain";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@shared/supabase/server";

type SyncBody = {
  organization_id?: string | null;
  scope?: "all" | "leads" | "deals" | "reservations" | null;
  only_rule?: string | null;
  dry_run?: boolean | null;
  limit?: number | null;
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = (await parseJsonBody<SyncBody>(request)) ?? {};
  const organizationIdHint = asText(body.organization_id);

  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint,
    allowedRoles: CRM_ADMIN_ROLES,
    allowedPermissions: ["crm.notifications.write"],
  });
  if (access.error || !access.data) {
    return jsonResponse(
      {
        ok: false,
        error: access.error?.error ?? "crm_auth_required",
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

  try {
    const result = await syncNotificationsForOrganization(client, access.data.organization_id, {
      scope: body.scope ?? "all",
      onlyRule: normalizeNotificationRuleKey(body.only_rule),
      dryRun: body.dry_run === true,
      limit: toPositiveInt(String(body.limit ?? ""), 0, 0, 100000),
    });
    return jsonResponse({
      ok: true,
      data: result,
      meta: {
        storage: "supabase.crm.notifications",
      },
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    if (isMissingNotificationOrchestrationColumnError(details)) {
      return jsonResponse(
        {
          ok: false,
          error: "notifications_schema_incomplete",
          details,
        },
        { status: 503 }
      );
    }
    return jsonResponse(
      {
        ok: false,
        error: "notifications_sync_failed",
        details,
      },
      { status: 500 }
    );
  }
};

export const GET: APIRoute = async () => methodNotAllowed(["POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["POST"]);
export const PUT: APIRoute = async () => methodNotAllowed(["POST"]);
