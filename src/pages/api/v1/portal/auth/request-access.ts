import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";
import {
  asObject,
  asText,
  asUuid,
  generateInviteCode,
  hashInviteCode,
  mapPortalInviteRow,
} from "@/utils/crmPortal";

type RequestPortalAccessBody = {
  organization_id?: string;
  email?: string;
  full_name?: string;
  company_name?: string;
  commercial_name?: string;
  legal_name?: string;
  cif?: string;
  phone?: string | null;
  language?: string | null;
  notes?: string | null;
  project_property_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

const resolveDefaultOrganizationId = (): string | null => {
  const fromPublic = asText(import.meta.env.PUBLIC_CRM_ORGANIZATION_ID);
  if (fromPublic) return fromPublic;
  return asText(import.meta.env.CRM_ORGANIZATION_ID);
};

const buildExpiresAt = (hours = 168) => new Date(Date.now() + Math.max(1, hours) * 60 * 60 * 1000).toISOString();

const ensureProjectIsPromotion = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  organizationId: string,
  projectPropertyId: string | null
) => {
  if (!client || !projectPropertyId) return { ok: true as const, error: null as string | null, details: null as string | null };

  const { data, error } = await client
    .schema("crm")
    .from("properties")
    .select("id, record_type")
    .eq("organization_id", organizationId)
    .eq("id", projectPropertyId)
    .maybeSingle();

  if (error) {
    return {
      ok: false as const,
      error: "db_project_property_read_error",
      details: error.message,
      status: 500,
    };
  }

  if (!data) {
    return {
      ok: false as const,
      error: "project_property_not_found",
      details: null,
      status: 422,
    };
  }

  if (asText((data as Record<string, unknown>).record_type) !== "project") {
    return {
      ok: false as const,
      error: "project_property_must_be_project",
      details: null,
      status: 422,
    };
  }

  return { ok: true as const, error: null as string | null, details: null as string | null };
};

const isSelfSignupRequestInvite = (row: Record<string, unknown> | null | undefined): boolean => {
  const metadata = asObject(row?.metadata);
  return asText(metadata.request_type) === "self_signup";
};

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<RequestPortalAccessBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationId = asText(body.organization_id) ?? resolveDefaultOrganizationId();
  const email = asText(body.email)?.toLowerCase() ?? null;
  const fullName = asText(body.full_name);
  const companyName = asText(body.company_name);
  const commercialName = asText(body.commercial_name);
  const legalName = asText(body.legal_name);
  const cif = asText(body.cif);
  const phone = asText(body.phone);
  const language = asText(body.language) ?? "es";
  const notes = asText(body.notes);
  const projectPropertyId = asUuid(body.project_property_id);
  const metadata = asObject(body.metadata);

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (!email) return jsonResponse({ ok: false, error: "email_required" }, { status: 422 });
  if (!fullName) return jsonResponse({ ok: false, error: "full_name_required" }, { status: 422 });
  if (!companyName) return jsonResponse({ ok: false, error: "company_name_required" }, { status: 422 });
  if (!commercialName) return jsonResponse({ ok: false, error: "commercial_name_required" }, { status: 422 });
  if (!legalName) return jsonResponse({ ok: false, error: "legal_name_required" }, { status: 422 });
  if (!cif) return jsonResponse({ ok: false, error: "cif_required" }, { status: 422 });

  if (!hasSupabaseServerClient()) {
    return jsonResponse(
      {
        ok: true,
        data: {
          request_id: `req_${crypto.randomUUID()}`,
          organization_id: organizationId,
          email,
          full_name: fullName,
          company_name: companyName,
          commercial_name: commercialName,
          legal_name: legalName,
          cif,
          phone,
          language,
          project_property_id: projectPropertyId,
          status: "pending",
        },
        meta: {
          request_status: "created",
          persisted: false,
          storage: "mock_in_memory",
        },
      },
      { status: 201 }
    );
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const projectValidation = await ensureProjectIsPromotion(client, organizationId, projectPropertyId);
  if (!projectValidation.ok) {
    return jsonResponse(
      {
        ok: false,
        error: projectValidation.error,
        details: projectValidation.details,
      },
      { status: (projectValidation as { status?: number }).status ?? 422 }
    );
  }

  const { data: pendingRows, error: pendingError } = await client
    .schema("crm")
    .from("portal_invites")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("email_normalized", email)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(10);

  if (pendingError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_invites_read_error",
        details: pendingError.message,
      },
      { status: 500 }
    );
  }

  const pending = (pendingRows ?? []) as Array<Record<string, unknown>>;
  const pendingSelfRequest = pending.find((row) => {
    const metadataRow = asObject(row.metadata);
    return (
      asText(row.invite_type) === "client" &&
      asText(row.role) === "portal_client" &&
      asText(metadataRow.request_type) === "self_signup" &&
      asText(metadataRow.approval_status) === "requested"
    );
  });

  if (pendingSelfRequest) {
    return jsonResponse({
      ok: true,
      data: {
        request: mapPortalInviteRow(pendingSelfRequest),
      },
      meta: {
        request_status: "already_pending",
        persisted: true,
        storage: "supabase.crm.portal_invites",
      },
    });
  }

  const pendingManualInvite = pending.find((row) => !isSelfSignupRequestInvite(row));
  if (pendingManualInvite) {
    return jsonResponse({
      ok: true,
      data: {
        invite: mapPortalInviteRow(pendingManualInvite),
      },
      meta: {
        request_status: "invite_already_pending",
        persisted: true,
        storage: "supabase.crm.portal_invites",
      },
    });
  }

  const inviteCode = generateInviteCode(8);
  const codeHash = await hashInviteCode(inviteCode);

  const requestPayload = {
    organization_id: organizationId,
    email,
    invite_type: "client",
    role: "portal_client",
    project_property_id: projectPropertyId,
    code_hash: codeHash,
    code_last4: inviteCode.slice(-4),
    status: "pending",
    expires_at: buildExpiresAt(168),
    max_attempts: 1,
    metadata: {
      ...metadata,
      request_type: "self_signup",
      approval_status: "requested",
      requested_at: new Date().toISOString(),
      requested_from: "portal_login",
      requester: {
        full_name: fullName,
        email,
        company_name: companyName,
        commercial_name: commercialName,
        legal_name: legalName,
        cif,
        phone,
        language,
        notes,
      },
    },
  };

  const { data: insertedRow, error: insertError } = await client
    .schema("crm")
    .from("portal_invites")
    .insert(requestPayload)
    .select("*")
    .single();

  if (insertError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_signup_request_insert_error",
        details: insertError.message,
      },
      { status: 500 }
    );
  }

  return jsonResponse(
    {
      ok: true,
      data: {
        request: mapPortalInviteRow(insertedRow as Record<string, unknown>),
      },
      meta: {
        request_status: "created",
        persisted: true,
        storage: "supabase.crm.portal_invites",
      },
    },
    { status: 201 }
  );
};

export const GET: APIRoute = async () => methodNotAllowed(["POST"]);
export const PUT: APIRoute = async () => methodNotAllowed(["POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["POST"]);
