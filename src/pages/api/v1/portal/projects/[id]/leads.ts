import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { getSupabaseServerClient } from "@/utils/supabaseServer";
import {
  asObject,
  asText,
  asUuid,
  getActivePortalMembershipForProject,
  getRequestIp,
  getRequestUserAgent,
  safeInsertPortalAccessLog,
} from "@/utils/crmPortal";
import { resolvePortalRequestContext } from "@/utils/portalAuth";

type CreatePortalLeadBody = {
  full_name?: string;
  email?: string | null;
  phone?: string | null;
  language?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  timeline?: string | null;
  notes?: string | null;
  operation_interest?: "sale" | "rent" | "both";
  consent?: boolean | null;
  metadata?: Record<string, unknown> | null;
};

const getProjectId = (params: Record<string, string | undefined>): string | null => {
  const value = params.id;
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const normalizeOperationInterest = (value: unknown): "sale" | "rent" | "both" => {
  if (value === "sale" || value === "rent" || value === "both") return value;
  return "sale";
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const asBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  return null;
};

const findOrCreateLeadContact = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  organizationId: string,
  fullName: string,
  email: string | null,
  phone: string | null,
  language: string | null
) => {
  if (!client) return { contactId: null as string | null, error: "supabase_not_configured" };

  if (email) {
    const { data: byEmail, error: byEmailError } = await client
      .schema("crm")
      .from("contacts")
      .select("id")
      .eq("organization_id", organizationId)
      .ilike("email", email)
      .order("created_at", { ascending: true })
      .limit(1);

    if (byEmailError) return { contactId: null as string | null, error: byEmailError.message };
    const first = Array.isArray(byEmail) && byEmail.length ? byEmail[0] : null;
    const existingId = asText((first as Record<string, unknown> | null)?.id);
    if (existingId) return { contactId: existingId, error: null as string | null };
  }

  if (phone) {
    const { data: byPhone, error: byPhoneError } = await client
      .schema("crm")
      .from("contacts")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("phone", phone)
      .order("created_at", { ascending: true })
      .limit(1);

    if (byPhoneError) return { contactId: null as string | null, error: byPhoneError.message };
    const first = Array.isArray(byPhone) && byPhone.length ? byPhone[0] : null;
    const existingId = asText((first as Record<string, unknown> | null)?.id);
    if (existingId) return { contactId: existingId, error: null as string | null };
  }

  const { data: inserted, error: insertError } = await client
    .schema("crm")
    .from("contacts")
    .insert({
      organization_id: organizationId,
      contact_type: "lead",
      full_name: fullName,
      email,
      phone,
      preferred_language: language ?? "es",
    })
    .select("id")
    .single();

  if (insertError) return { contactId: null as string | null, error: insertError.message };
  return { contactId: asText((inserted as Record<string, unknown>).id), error: null as string | null };
};

const findDuplicateLead = async (
  client: ReturnType<typeof getSupabaseServerClient>,
  organizationId: string,
  projectId: string,
  contactId: string
) => {
  if (!client) return null;
  const { data } = await client
    .schema("crm")
    .from("leads")
    .select("id, status, created_at")
    .eq("organization_id", organizationId)
    .eq("property_id", projectId)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: true })
    .limit(1);

  const first = Array.isArray(data) && data.length ? data[0] : null;
  return asUuid((first as Record<string, unknown> | null)?.id);
};

export const POST: APIRoute = async ({ params, request, url }) => {
  const projectId = getProjectId(params);
  if (!projectId) return jsonResponse({ ok: false, error: "project_id_required" }, { status: 400 });

  const organizationIdHint = asText(url.searchParams.get("organization_id"));
  const body = await parseJsonBody<CreatePortalLeadBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const fullName = asText(body.full_name);
  const email = asText(body.email)?.toLowerCase() ?? null;
  const phone = asText(body.phone);
  const language = asText(body.language);
  const operationInterest = normalizeOperationInterest(body.operation_interest);
  const budgetMin = asNumber(body.budget_min);
  const budgetMax = asNumber(body.budget_max);
  const timeline = asText(body.timeline);
  const notes = asText(body.notes);
  const consent = asBoolean(body.consent);
  const metadata = asObject(body.metadata);

  if (!fullName) return jsonResponse({ ok: false, error: "full_name_required" }, { status: 422 });
  if (!email && !phone) {
    return jsonResponse({ ok: false, error: "email_or_phone_required" }, { status: 422 });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const auth = await resolvePortalRequestContext(request, { organizationIdHint });
  if (auth.error || !auth.data) {
    return jsonResponse(
      {
        ok: false,
        error: auth.error?.error ?? "auth_context_unresolved",
        details: auth.error?.details,
      },
      { status: auth.error?.status ?? 401 }
    );
  }

  const portalAccountId = auth.data.portal_account.id;
  const organizationId = auth.data.organization_id;
  if (!portalAccountId) return jsonResponse({ ok: false, error: "portal_account_id_missing" }, { status: 500 });

  const membership = await getActivePortalMembershipForProject(client, portalAccountId, projectId, organizationId);
  if (membership.error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_membership_read_error",
        details: membership.error.message,
      },
      { status: 500 }
    );
  }
  if (!membership.data) return jsonResponse({ ok: false, error: "project_access_denied" }, { status: 403 });

  const contactResult = await findOrCreateLeadContact(client, organizationId, fullName, email, phone, language);
  if (contactResult.error || !contactResult.contactId) {
    return jsonResponse(
      {
        ok: false,
        error: "db_contact_create_error",
        details: contactResult.error ?? "contact_id_missing",
      },
      { status: 500 }
    );
  }

  const duplicateLeadId = await findDuplicateLead(client, organizationId, projectId, contactResult.contactId);

  const leadPayload = {
    organization_id: organizationId,
    property_id: projectId,
    contact_id: contactResult.contactId,
    agency_id: auth.data.portal_account.agency_id,
    lead_kind: "buyer",
    origin_type: "portal",
    source: "portal_agent",
    status: duplicateLeadId ? "discarded" : "new",
    operation_interest: operationInterest,
    budget_min: budgetMin,
    budget_max: budgetMax,
    discarded_reason: duplicateLeadId ? "duplicate_portal_submission" : null,
    raw_payload: {
      portal: {
        timeline,
        notes,
        consent,
      },
      metadata,
    },
  };

  const { data: leadRow, error: leadError } = await client
    .schema("crm")
    .from("leads")
    .insert(leadPayload)
    .select("*")
    .single();

  if (leadError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_lead_insert_error",
        details: leadError.message,
      },
      { status: 500 }
    );
  }

  const leadId = asUuid((leadRow as Record<string, unknown>).id);
  if (!leadId) return jsonResponse({ ok: false, error: "lead_id_missing_after_insert" }, { status: 500 });

  const attributionStatus = duplicateLeadId ? "rejected_duplicate" : "pending_review";
  const nowIso = new Date().toISOString();
  const trackingPayload = {
    organization_id: organizationId,
    lead_id: leadId,
    project_property_id: projectId,
    portal_account_id: portalAccountId,
    attribution_status: attributionStatus,
    duplicate_of_lead_id: duplicateLeadId,
    evidence: {
      submitted_at: nowIso,
      full_name: fullName,
      email,
      phone,
      operation_interest: operationInterest,
      budget_min: budgetMin,
      budget_max: budgetMax,
      timeline,
      consent,
    },
    timeline: [
      {
        at: nowIso,
        status: duplicateLeadId ? "rejected_duplicate" : "recibido",
        actor: "portal",
      },
    ],
  };

  const { data: trackingRow, error: trackingError } = await client
    .schema("crm")
    .from("portal_lead_tracking")
    .insert(trackingPayload)
    .select("*")
    .single();

  if (trackingError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_lead_tracking_insert_error",
        details: trackingError.message,
      },
      { status: 500 }
    );
  }

  await safeInsertPortalAccessLog(client, {
    organization_id: organizationId,
    portal_account_id: portalAccountId,
    lead_id: leadId,
    project_property_id: projectId,
    email,
    event_type: "lead_submitted",
    ip: getRequestIp(request),
    user_agent: getRequestUserAgent(request),
    metadata: {
      attribution_status: attributionStatus,
      duplicate_of_lead_id: duplicateLeadId,
    },
  });

  if (duplicateLeadId) {
    await safeInsertPortalAccessLog(client, {
      organization_id: organizationId,
      portal_account_id: portalAccountId,
      lead_id: leadId,
      project_property_id: projectId,
      email,
      event_type: "duplicate_detected",
      ip: getRequestIp(request),
      user_agent: getRequestUserAgent(request),
      metadata: {
        duplicate_of_lead_id: duplicateLeadId,
      },
    });
  }

  return jsonResponse(
    {
      ok: true,
      data: {
        lead: leadRow,
        tracking: trackingRow,
      },
      meta: {
        persisted: true,
        storage: "supabase.crm.leads + crm.portal_lead_tracking",
      },
    },
    { status: 201 }
  );
};

export const GET: APIRoute = async () => methodNotAllowed(["POST"]);
export const PUT: APIRoute = async () => methodNotAllowed(["POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["POST"]);
