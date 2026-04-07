import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@shared/supabase/server";
import { CRM_ADMIN_ROLES, resolveCrmOrgAccess } from "@shared/crm/access";
import { isPortalMockFallbackEnabled, portalMockFallbackDisabledResponse } from "@shared/http/portal/mockFallback";
import {
  PORTAL_ACCOUNT_SELECT_COLUMNS,
  PORTAL_INVITE_SELECT_COLUMNS,
  PORTAL_MEMBERSHIP_SELECT_COLUMNS,
  asObject,
  asText,
  asUuid,
  extractPortalProfile,
  mapPortalAccountRow,
  mapPortalInviteRow,
  mapPortalMembershipRow,
  normalizePortalRole,
} from "@shared/portal/domain";

type PatchPortalAccountBody = {
  organization_id?: string;
  status?: "pending" | "active" | "blocked" | "revoked";
  role?: "portal_agent_admin" | "portal_agent_member" | "portal_client";
  access_mode?: "all" | "selected";
};

const asPortalAccountStatus = (value: unknown) => {
  if (value === "pending" || value === "active" || value === "blocked" || value === "revoked") {
    return value;
  }
  return null;
};

const decoratePortalAccount = (row: ReturnType<typeof mapPortalAccountRow>) => {
  const profile = extractPortalProfile(row.metadata);
  const metadata = row.metadata as Record<string, unknown>;
  return {
    ...row,
    email: profile.email,
    full_name: profile.full_name,
    professional_type: profile.professional_type,
    company_name: profile.company_name,
    commercial_name: profile.commercial_name,
    legal_name: profile.legal_name,
    cif: profile.cif,
    phone: profile.phone,
    language: profile.language,
    notes: profile.notes,
    access: {
      mode: asText(metadata.access_mode) ?? (row.role === "portal_agent_admin" ? "all" : "selected"),
      approved_project_property_ids: Array.isArray(metadata.approved_project_property_ids)
        ? metadata.approved_project_property_ids
        : [],
    },
    source: {
      registration_request_id: asText(metadata.registration_request_id),
      approval_invite_id: asText(metadata.approval_invite_id),
      activation_invite_id: asText(metadata.activation_invite_id),
    },
  };
};

const getPortalAccountId = (params: Record<string, string | undefined>) => {
  const value = params.id;
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

export const GET: APIRoute = async ({ params, url, cookies }) => {
  const organizationId = asText(url.searchParams.get("organization_id"));
  const portalAccountId = asUuid(getPortalAccountId(params));

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (!portalAccountId) return jsonResponse({ ok: false, error: "portal_account_id_required" }, { status: 422 });

  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint: organizationId,
    allowedRoles: CRM_ADMIN_ROLES,
    allowedPermissions: ["crm.users.manage"],
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
    if (!isPortalMockFallbackEnabled()) {
      return portalMockFallbackDisabledResponse(
        "portal_user_detail_backend_unavailable",
        "Activa Supabase o habilita CRM_ENABLE_MOCK_FALLBACKS=true solo en desarrollo para usar mocks."
      );
    }
    return jsonResponse({
      ok: true,
      data: null,
      meta: {
        persisted: false,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const { data: accountRow, error: accountError } = await client
    .schema("crm")
    .from("portal_accounts")
    .select(PORTAL_ACCOUNT_SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", portalAccountId)
    .maybeSingle();

  if (accountError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_account_read_error",
        details: accountError.message,
      },
      { status: 500 }
    );
  }
  if (!accountRow) return jsonResponse({ ok: false, error: "portal_account_not_found" }, { status: 404 });

  const decoratedAccount = decoratePortalAccount(mapPortalAccountRow(accountRow as Record<string, unknown>));
  const metadata = asObject(decoratedAccount.metadata);

  const { data: membershipsRaw, error: membershipsError } = await client
    .schema("crm")
    .from("portal_memberships")
    .select(PORTAL_MEMBERSHIP_SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("portal_account_id", portalAccountId)
    .order("created_at", { ascending: false });

  if (membershipsError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_memberships_read_error",
        details: membershipsError.message,
      },
      { status: 500 }
    );
  }

  const memberships = ((membershipsRaw ?? []) as Array<Record<string, unknown>>).map((row) =>
    mapPortalMembershipRow(row)
  );

  const inviteIds = [
    asUuid(metadata.registration_request_id),
    asUuid(metadata.approval_invite_id),
    asUuid(metadata.activation_invite_id),
  ].filter((value): value is string => Boolean(value));

  let invitesById = new Map<string, ReturnType<typeof mapPortalInviteRow>>();
  if (inviteIds.length) {
    const { data: invitesRaw, error: invitesError } = await client
      .schema("crm")
      .from("portal_invites")
      .select(PORTAL_INVITE_SELECT_COLUMNS)
      .in("id", inviteIds);

    if (invitesError) {
      return jsonResponse(
        {
          ok: false,
          error: "db_portal_invites_read_error",
          details: invitesError.message,
        },
        { status: 500 }
      );
    }

    invitesById = new Map(
      ((invitesRaw ?? []) as Array<Record<string, unknown>>)
        .map((row) => mapPortalInviteRow(row))
        .filter((entry) => entry.id)
        .map((entry) => [entry.id as string, entry])
    );
  }

  return jsonResponse({
    ok: true,
    data: {
      account: decoratedAccount,
      memberships,
      sources: {
        registration_request: invitesById.get(asUuid(metadata.registration_request_id) ?? ""),
        approval_invite: invitesById.get(asUuid(metadata.approval_invite_id) ?? ""),
        activation_invite: invitesById.get(asUuid(metadata.activation_invite_id) ?? ""),
      },
    },
    meta: {
      storage: "supabase.crm.portal_accounts + crm.portal_memberships + crm.portal_invites",
    },
  });
};

export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  const body = await parseJsonBody<PatchPortalAccountBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationId = asText(body.organization_id);
  const portalAccountId = asUuid(getPortalAccountId(params));
  const status = asPortalAccountStatus(body.status);
  const role = body.role ? normalizePortalRole(body.role) : null;
  const accessMode = body.access_mode === "all" || body.access_mode === "selected" ? body.access_mode : null;

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (!portalAccountId) return jsonResponse({ ok: false, error: "portal_account_id_required" }, { status: 422 });
  if (!status && !role && !accessMode) return jsonResponse({ ok: false, error: "no_fields_to_update" }, { status: 422 });

  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint: organizationId,
    allowedRoles: CRM_ADMIN_ROLES,
    allowedPermissions: ["crm.users.manage"],
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
    if (!isPortalMockFallbackEnabled()) {
      return portalMockFallbackDisabledResponse(
        "portal_user_detail_backend_unavailable",
        "Activa Supabase o habilita CRM_ENABLE_MOCK_FALLBACKS=true solo en desarrollo para usar mocks."
      );
    }
    return jsonResponse({
      ok: true,
      data: {
        id: portalAccountId,
        organization_id: organizationId,
        status,
      },
      meta: {
        persisted: false,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const { data: currentAccountRow, error: currentAccountError } = await client
    .schema("crm")
    .from("portal_accounts")
    .select(PORTAL_ACCOUNT_SELECT_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", portalAccountId)
    .maybeSingle();

  if (currentAccountError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_account_read_error",
        details: currentAccountError.message,
      },
      { status: 500 }
    );
  }
  if (!currentAccountRow) return jsonResponse({ ok: false, error: "portal_account_not_found" }, { status: 404 });

  const currentMapped = mapPortalAccountRow(currentAccountRow as Record<string, unknown>);
  const currentMetadata = asObject(currentMapped.metadata);
  const nextRole = role ?? currentMapped.role;
  const nextAccessMode = accessMode ?? asText(currentMetadata.access_mode) ?? (nextRole === "portal_agent_admin" ? "all" : "selected");
  const updatePayload: Record<string, unknown> = {
    metadata: {
      ...currentMetadata,
      access_mode: nextAccessMode,
      approved_project_property_ids:
        nextAccessMode === "all" ? [] : Array.isArray(currentMetadata.approved_project_property_ids) ? currentMetadata.approved_project_property_ids : [],
    },
  };
  if (status) updatePayload.status = status;
  if (role) updatePayload.role = role;

  const { data, error } = await client
    .schema("crm")
    .from("portal_accounts")
    .update(updatePayload)
    .eq("organization_id", organizationId)
    .eq("id", portalAccountId)
    .select(PORTAL_ACCOUNT_SELECT_COLUMNS)
    .single();

  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_account_update_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  return jsonResponse({
    ok: true,
    data: decoratePortalAccount(mapPortalAccountRow(data as Record<string, unknown>)),
    meta: {
      storage: "supabase.crm.portal_accounts",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
