import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { getSupabaseServerClient } from "@/utils/supabaseServer";
import {
  asObject,
  asText,
  asUuid,
  getRequestIp,
  getRequestUserAgent,
  safeInsertPortalAccessLog,
} from "@/utils/crmPortal";
import { resolvePortalRequestContext } from "@/utils/portalAuth";

type CreateVisitRequestBody = {
  request_mode?: "proposal_slots" | "direct_booking";
  proposed_slots?: string[] | Array<Record<string, unknown>>;
  notes?: string | null;
};

const getLeadId = (params: Record<string, string | undefined>): string | null => {
  const value = params.id;
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const normalizeRequestMode = (value: unknown): "proposal_slots" | "direct_booking" => {
  if (value === "proposal_slots" || value === "direct_booking") return value;
  return "proposal_slots";
};

const normalizeProposedSlots = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).map((entry) => {
    if (typeof entry === "string") return entry;
    if (entry && typeof entry === "object") return asObject(entry);
    return String(entry);
  });
};

export const POST: APIRoute = async ({ params, request, url }) => {
  const leadId = getLeadId(params);
  if (!leadId) return jsonResponse({ ok: false, error: "lead_id_required" }, { status: 400 });

  const organizationIdHint = asText(url.searchParams.get("organization_id"));
  const body = await parseJsonBody<CreateVisitRequestBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const requestMode = normalizeRequestMode(body.request_mode);
  const proposedSlots = normalizeProposedSlots(body.proposed_slots);
  const notes = asText(body.notes);

  if (requestMode === "proposal_slots" && (proposedSlots.length < 2 || proposedSlots.length > 3)) {
    return jsonResponse({ ok: false, error: "proposal_slots_requires_2_to_3_entries" }, { status: 422 });
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

  const { data: trackingRow, error: trackingError } = await client
    .schema("crm")
    .from("portal_lead_tracking")
    .select("id, project_property_id")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .eq("portal_account_id", portalAccountId)
    .maybeSingle();

  if (trackingError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_lead_tracking_read_error",
        details: trackingError.message,
      },
      { status: 500 }
    );
  }
  if (!trackingRow) return jsonResponse({ ok: false, error: "lead_access_denied" }, { status: 403 });

  const projectPropertyId = asUuid((trackingRow as Record<string, unknown>).project_property_id);
  if (!projectPropertyId) {
    return jsonResponse({ ok: false, error: "project_property_id_missing_for_lead" }, { status: 422 });
  }

  const payload = {
    organization_id: organizationId,
    lead_id: leadId,
    project_property_id: projectPropertyId,
    portal_account_id: portalAccountId,
    request_mode: requestMode,
    proposed_slots: proposedSlots,
    status: "requested",
    notes,
  };

  const { data, error } = await client
    .schema("crm")
    .from("portal_visit_requests")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_visit_request_insert_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  await safeInsertPortalAccessLog(client, {
    organization_id: organizationId,
    portal_account_id: portalAccountId,
    lead_id: leadId,
    project_property_id: projectPropertyId,
    email: null,
    event_type: "visit_requested",
    ip: getRequestIp(request),
    user_agent: getRequestUserAgent(request),
    metadata: {
      visit_request_id: asUuid((data as Record<string, unknown>).id),
      request_mode: requestMode,
      proposed_slots_count: proposedSlots.length,
    },
  });

  return jsonResponse(
    {
      ok: true,
      data,
      meta: {
        persisted: true,
        storage: "supabase.crm.portal_visit_requests",
      },
    },
    { status: 201 }
  );
};

export const GET: APIRoute = async () => methodNotAllowed(["POST"]);
export const PUT: APIRoute = async () => methodNotAllowed(["POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["POST"]);
