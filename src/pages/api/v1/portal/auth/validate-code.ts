import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";
import {
  asText,
  asUuid,
  findLatestPendingInviteRowByEmail,
  getRequestIp,
  getRequestUserAgent,
  mapPortalInviteRow,
  safeInsertPortalAccessLog,
  verifyInviteCode,
} from "@/utils/crmPortal";

type ValidatePortalCodeBody = {
  organization_id?: string;
  email?: string;
  code?: string;
  project_property_id?: string | null;
};

const updateInviteAttempt = async (
  inviteRow: Record<string, unknown>,
  isValid: boolean,
  client: ReturnType<typeof getSupabaseServerClient>
) => {
  if (!client) return null;
  const inviteId = asUuid(inviteRow.id);
  if (!inviteId) return null;

  const currentAttempts = Number(inviteRow.attempt_count ?? 0);
  const maxAttempts = Number(inviteRow.max_attempts ?? 5);
  const nextAttempts = isValid ? currentAttempts : currentAttempts + 1;
  const shouldBlock = !isValid && nextAttempts >= maxAttempts;

  const payload: Record<string, unknown> = {
    attempt_count: nextAttempts,
  };
  if (shouldBlock) {
    payload.status = "blocked";
    payload.blocked_at = new Date().toISOString();
  }

  const { data, error } = await client
    .schema("crm")
    .from("portal_invites")
    .update(payload)
    .eq("id", inviteId)
    .select("*")
    .single();

  if (error) return null;
  return data as Record<string, unknown>;
};

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<ValidatePortalCodeBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationId = asText(body.organization_id);
  const email = asText(body.email)?.toLowerCase() ?? null;
  const code = asText(body.code)?.toUpperCase() ?? null;
  const projectPropertyId = asUuid(body.project_property_id);

  if (!organizationId) {
    return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  }
  if (!email) {
    return jsonResponse({ ok: false, error: "email_required" }, { status: 422 });
  }
  if (!code) {
    return jsonResponse({ ok: false, error: "code_required" }, { status: 422 });
  }

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: {
        valid: true,
        invite: {
          id: `inv_${crypto.randomUUID()}`,
          organization_id: organizationId,
          email,
          invite_type: "client",
          role: "portal_client",
          project_property_id: projectPropertyId,
        },
      },
      meta: {
        persisted: false,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const inviteResult = await findLatestPendingInviteRowByEmail(client, organizationId, email, projectPropertyId);
  if (inviteResult.error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_invite_read_error",
        details: inviteResult.error.message,
      },
      { status: 500 }
    );
  }
  if (!inviteResult.data) {
    return jsonResponse(
      {
        ok: false,
        error: "invite_not_found_or_expired",
      },
      { status: 404 }
    );
  }

  const codeHash = asText(inviteResult.data.code_hash);
  if (!codeHash) {
    return jsonResponse({ ok: false, error: "invite_code_hash_missing" }, { status: 500 });
  }

  const isValid = await verifyInviteCode(codeHash, code);
  const inviteAfterAttempt = await updateInviteAttempt(inviteResult.data, isValid, client);
  const effectiveInvite = inviteAfterAttempt ?? inviteResult.data;

  if (!isValid) {
    await safeInsertPortalAccessLog(client, {
      organization_id: organizationId,
      email,
      project_property_id: asText(inviteResult.data.project_property_id),
      event_type: "code_fail",
      ip: getRequestIp(request),
      user_agent: getRequestUserAgent(request),
      metadata: {
        invite_id: asText(inviteResult.data.id),
        attempt_count: Number(effectiveInvite.attempt_count ?? 0),
      },
    });

    if (asText(effectiveInvite.status) === "blocked") {
      await safeInsertPortalAccessLog(client, {
        organization_id: organizationId,
        email,
        project_property_id: asText(inviteResult.data.project_property_id),
        event_type: "blocked",
        ip: getRequestIp(request),
        user_agent: getRequestUserAgent(request),
        metadata: {
          reason: "max_attempts_reached",
          invite_id: asText(inviteResult.data.id),
        },
      });
    }

    return jsonResponse(
      {
        ok: false,
        error: asText(effectiveInvite.status) === "blocked" ? "invite_blocked" : "invalid_code",
        data: {
          remaining_attempts: Math.max(
            0,
            Number(effectiveInvite.max_attempts ?? 5) - Number(effectiveInvite.attempt_count ?? 0)
          ),
        },
      },
      { status: 422 }
    );
  }

  return jsonResponse({
    ok: true,
    data: {
      valid: true,
      invite: mapPortalInviteRow(effectiveInvite),
    },
    meta: {
      storage: "supabase.crm.portal_invites",
      persisted: true,
    },
  });
};

export const GET: APIRoute = async () => methodNotAllowed(["POST"]);
export const PUT: APIRoute = async () => methodNotAllowed(["POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["POST"]);
