import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";
import {
  asObject,
  asText,
  asUuid,
  getPortalInviteById,
  getRequestIp,
  getRequestUserAgent,
  safeInsertPortalAccessLog,
} from "@/utils/crmPortal";

type RevokePortalInviteBody = {
  organization_id?: string;
  reason?: string | null;
  revoked_by?: string | null;
};

const getInviteId = (params: Record<string, string | undefined>): string | null => {
  const value = params.id;
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

export const POST: APIRoute = async ({ params, request }) => {
  const inviteId = getInviteId(params);
  if (!inviteId) {
    return jsonResponse({ ok: false, error: "invite_id_required" }, { status: 400 });
  }

  const body = await parseJsonBody<RevokePortalInviteBody>(request);
  const organizationId = asText(body?.organization_id);
  const reason = asText(body?.reason);
  const revokedBy = asUuid(body?.revoked_by);

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: {
        id: inviteId,
        status: "revoked",
      },
      meta: {
        persisted: false,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const current = await getPortalInviteById(client, inviteId);
  if (current.error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_invite_read_error",
        details: current.error.message,
      },
      { status: 500 }
    );
  }
  if (!current.data) {
    return jsonResponse({ ok: false, error: "portal_invite_not_found" }, { status: 404 });
  }
  if (organizationId && current.data.organization_id !== organizationId) {
    return jsonResponse({ ok: false, error: "portal_invite_not_found" }, { status: 404 });
  }

  const { data, error } = await client
    .schema("crm")
    .from("portal_invites")
    .update({
      status: "revoked",
      revoked_at: new Date().toISOString(),
      metadata: {
        ...asObject(current.data.metadata),
        revoke_reason: reason,
        revoked_by: revokedBy,
      },
    })
    .eq("id", inviteId)
    .select("*")
    .single();

  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_invite_revoke_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  await safeInsertPortalAccessLog(client, {
    organization_id: String((data as Record<string, unknown>).organization_id),
    email: asText((data as Record<string, unknown>).email),
    project_property_id: asText((data as Record<string, unknown>).project_property_id),
    event_type: "invite_revoked",
    ip: getRequestIp(request),
    user_agent: getRequestUserAgent(request),
    metadata: {
      invite_id: inviteId,
      revoked_by: revokedBy,
      reason,
    },
  });

  return jsonResponse({
    ok: true,
    data,
    meta: {
      persisted: true,
      storage: "supabase.crm.portal_invites",
    },
  });
};

export const GET: APIRoute = async () => methodNotAllowed(["POST"]);
export const PUT: APIRoute = async () => methodNotAllowed(["POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["POST"]);
