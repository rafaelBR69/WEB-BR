import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";
import {
  asNumber,
  asObject,
  asText,
  asUuid,
  defaultMembershipScopeForRole,
  findLatestPendingInviteRowByEmail,
  getRequestIp,
  getRequestUserAgent,
  mapPortalAccountRow,
  mapPortalInviteRow,
  mapPortalMembershipRow,
  normalizePortalRole,
  safeInsertPortalAccessLog,
  verifyInviteCode,
} from "@/utils/crmPortal";

type ActivatePortalBody = {
  organization_id?: string;
  email?: string;
  code?: string;
  password?: string;
  full_name?: string | null;
  auth_user_id?: string | null;
  project_property_id?: string | null;
  metadata?: Record<string, unknown> | null;
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

const resolveFullName = (email: string, rawName: string | null): string => {
  if (rawName && rawName.trim().length) return rawName.trim();
  const userPart = email.split("@")[0] ?? "Portal User";
  return userPart.replace(/[._-]+/g, " ").trim() || "Portal User";
};

const findOrCreateContact = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  organizationId: string,
  email: string,
  fullName: string,
  inviteType: "agent" | "client"
) => {
  if (!client) return { contactId: null as string | null, error: "supabase_not_configured" };

  const { data: existingContact, error: readError } = await client
    .schema("crm")
    .from("contacts")
    .select("id")
    .eq("organization_id", organizationId)
    .ilike("email", email)
    .order("created_at", { ascending: true })
    .limit(1);

  if (readError) return { contactId: null as string | null, error: readError.message };
  const first = Array.isArray(existingContact) && existingContact.length ? existingContact[0] : null;
  const existingId = asText((first as Record<string, unknown> | null)?.id);
  if (existingId) return { contactId: existingId, error: null as string | null };

  const { data: inserted, error: insertError } = await client
    .schema("crm")
    .from("contacts")
    .insert({
      organization_id: organizationId,
      contact_type: inviteType === "agent" ? "agency" : "client",
      full_name: fullName,
      email,
      preferred_language: "es",
    })
    .select("id")
    .single();

  if (insertError) return { contactId: null as string | null, error: insertError.message };
  return { contactId: asText((inserted as Record<string, unknown>).id), error: null as string | null };
};

const resolveClientAndAgencyFromContact = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  organizationId: string,
  contactId: string | null
) => {
  if (!client || !contactId) {
    return { clientId: null as string | null, agencyId: null as string | null };
  }

  const { data: clientRow } = await client
    .schema("crm")
    .from("clients")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .maybeSingle();

  const clientId = asText((clientRow as Record<string, unknown> | null)?.id);
  if (!clientId) return { clientId: null as string | null, agencyId: null as string | null };

  const { data: agencyRow } = await client
    .schema("crm")
    .from("agencies")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: true })
    .limit(1);

  const firstAgency = Array.isArray(agencyRow) && agencyRow.length ? agencyRow[0] : null;
  return {
    clientId,
    agencyId: asText((firstAgency as Record<string, unknown> | null)?.id),
  };
};

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<ActivatePortalBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationId = asText(body.organization_id);
  const email = asText(body.email)?.toLowerCase() ?? null;
  const code = asText(body.code)?.toUpperCase() ?? null;
  const password = asText(body.password);
  const explicitAuthUserId = asUuid(body.auth_user_id);
  const requestedProjectPropertyId = asUuid(body.project_property_id);
  const metadata = asObject(body.metadata);

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (!email) return jsonResponse({ ok: false, error: "email_required" }, { status: 422 });
  if (!code) return jsonResponse({ ok: false, error: "code_required" }, { status: 422 });
  if (!explicitAuthUserId && !password) {
    return jsonResponse({ ok: false, error: "password_required" }, { status: 422 });
  }
  if (password && password.length < 8) {
    return jsonResponse({ ok: false, error: "password_min_length_8" }, { status: 422 });
  }

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: {
        auth_user_id: explicitAuthUserId ?? `usr_${crypto.randomUUID()}`,
        portal_account: {
          id: `pa_${crypto.randomUUID()}`,
          organization_id: organizationId,
          role: "portal_client",
          status: "active",
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

  const inviteResult = await findLatestPendingInviteRowByEmail(
    client,
    organizationId,
    email,
    requestedProjectPropertyId
  );
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
    return jsonResponse({ ok: false, error: "invite_not_found_or_expired" }, { status: 404 });
  }

  const codeHash = asText(inviteResult.data.code_hash);
  if (!codeHash) return jsonResponse({ ok: false, error: "invite_code_hash_missing" }, { status: 500 });

  const isValidCode = await verifyInviteCode(codeHash, code);
  const inviteAfterAttempt = await updateInviteAttempt(inviteResult.data, isValidCode, client);
  const effectiveInvite = inviteAfterAttempt ?? inviteResult.data;

  if (!isValidCode) {
    await safeInsertPortalAccessLog(client, {
      organization_id: organizationId,
      email,
      project_property_id: asText(inviteResult.data.project_property_id),
      event_type: "signup_fail",
      ip: getRequestIp(request),
      user_agent: getRequestUserAgent(request),
      metadata: {
        reason: "invalid_code",
        invite_id: asText(inviteResult.data.id),
        attempt_count: Number(effectiveInvite.attempt_count ?? 0),
      },
    });
    return jsonResponse({ ok: false, error: "invalid_code" }, { status: 422 });
  }

  let authUserId = explicitAuthUserId;
  if (!authUserId) {
    const createUser = await client.auth.admin.createUser({
      email,
      password: password as string,
      email_confirm: true,
      user_metadata: {
        full_name: resolveFullName(email, asText(body.full_name)),
        portal_organization_id: organizationId,
      },
    });

    if (createUser.error || !createUser.data?.user?.id) {
      await safeInsertPortalAccessLog(client, {
        organization_id: organizationId,
        email,
        project_property_id: asText(inviteResult.data.project_property_id),
        event_type: "signup_fail",
        ip: getRequestIp(request),
        user_agent: getRequestUserAgent(request),
        metadata: {
          reason: "auth_create_user_failed",
          detail: createUser.error?.message ?? null,
        },
      });

      return jsonResponse(
        {
          ok: false,
          error: "auth_create_user_failed",
          details: createUser.error?.message ?? "unknown_auth_error",
        },
        { status: 500 }
      );
    }
    authUserId = createUser.data.user.id;
  }

  const inviteRole = normalizePortalRole(inviteResult.data.role);
  const inviteType = (asText(inviteResult.data.invite_type) === "agent" ? "agent" : "client") as
    | "agent"
    | "client";
  const inviteProjectId = asUuid(inviteResult.data.project_property_id);
  const fullName = resolveFullName(email, asText(body.full_name));

  const contactResult = await findOrCreateContact(client, organizationId, email, fullName, inviteType);
  if (contactResult.error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_contact_create_error",
        details: contactResult.error,
      },
      { status: 500 }
    );
  }

  const links = await resolveClientAndAgencyFromContact(client, organizationId, contactResult.contactId);

  const accountPayload = {
    organization_id: organizationId,
    auth_user_id: authUserId,
    contact_id: contactResult.contactId,
    client_id: links.clientId,
    agency_id: links.agencyId,
    role: inviteRole,
    status: "active",
    metadata: {
      ...metadata,
      activation_invite_id: asText(inviteResult.data.id),
      activated_at: new Date().toISOString(),
    },
  };

  const { data: accountRow, error: accountError } = await client
    .schema("crm")
    .from("portal_accounts")
    .upsert(accountPayload, { onConflict: "organization_id,auth_user_id" })
    .select("*")
    .single();

  if (accountError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_account_upsert_error",
        details: accountError.message,
      },
      { status: 500 }
    );
  }

  const portalAccountId = asUuid((accountRow as Record<string, unknown>).id);
  let membershipRow: Record<string, unknown> | null = null;

  if (portalAccountId && inviteProjectId) {
    const { data: membershipData, error: membershipError } = await client
      .schema("crm")
      .from("portal_memberships")
      .upsert(
        {
          organization_id: organizationId,
          portal_account_id: portalAccountId,
          project_property_id: inviteProjectId,
          access_scope: defaultMembershipScopeForRole(inviteRole),
          status: "active",
          permissions: {},
        },
        { onConflict: "portal_account_id,project_property_id" }
      )
      .select("*")
      .single();

    if (membershipError) {
      return jsonResponse(
        {
          ok: false,
          error: "db_portal_membership_upsert_error",
          details: membershipError.message,
        },
        { status: 500 }
      );
    }
    membershipRow = (membershipData as Record<string, unknown>) ?? null;
  }

  const { data: usedInvite, error: usedInviteError } = await client
    .schema("crm")
    .from("portal_invites")
    .update({
      status: "used",
      used_at: new Date().toISOString(),
      metadata: {
        ...asObject(inviteResult.data.metadata),
        activated_auth_user_id: authUserId,
      },
    })
    .eq("id", asText(inviteResult.data.id))
    .select("*")
    .single();

  if (usedInviteError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_invite_consume_error",
        details: usedInviteError.message,
      },
      { status: 500 }
    );
  }

  await safeInsertPortalAccessLog(client, {
    organization_id: organizationId,
    portal_account_id: portalAccountId,
    email,
    project_property_id: inviteProjectId,
    event_type: "signup_ok",
    ip: getRequestIp(request),
    user_agent: getRequestUserAgent(request),
    metadata: {
      invite_id: asText(inviteResult.data.id),
      role: inviteRole,
    },
  });

  return jsonResponse(
    {
      ok: true,
      data: {
        auth_user_id: authUserId,
        portal_account: mapPortalAccountRow(accountRow as Record<string, unknown>),
        membership: membershipRow ? mapPortalMembershipRow(membershipRow) : null,
        invite: mapPortalInviteRow(usedInvite as Record<string, unknown>),
      },
      meta: {
        persisted: true,
        storage: "supabase.crm.portal_accounts",
      },
    },
    { status: 201 }
  );
};

export const GET: APIRoute = async () => methodNotAllowed(["POST"]);
export const PUT: APIRoute = async () => methodNotAllowed(["POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["POST"]);
