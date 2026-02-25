import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";
import { asText, asUuid, getRequestIp, getRequestUserAgent, safeInsertPortalAccessLog } from "@/utils/crmPortal";

type UpdateVisitRequestBody = {
  organization_id?: string;
  status?: "requested" | "confirmed" | "declined" | "done" | "no_show" | "cancelled";
  confirmed_slot?: string | null;
  notes?: string | null;
  confirmed_by?: string | null;
};

const getVisitRequestId = (params: Record<string, string | undefined>): string | null => {
  const value = params.id;
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const normalizeVisitStatus = (
  value: unknown
): "requested" | "confirmed" | "declined" | "done" | "no_show" | "cancelled" => {
  if (
    value === "requested" ||
    value === "confirmed" ||
    value === "declined" ||
    value === "done" ||
    value === "no_show" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "requested";
};

export const GET: APIRoute = async ({ params, url }) => {
  const visitRequestId = getVisitRequestId(params);
  const organizationId = asText(url.searchParams.get("organization_id"));

  if (!visitRequestId) return jsonResponse({ ok: false, error: "visit_request_id_required" }, { status: 400 });

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: {
        id: visitRequestId,
        status: "requested",
      },
      meta: {
        persisted: false,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  let query = client.schema("crm").from("portal_visit_requests").select("*").eq("id", visitRequestId).maybeSingle();
  if (organizationId) query = query.eq("organization_id", organizationId);

  const { data, error } = await query;
  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_visit_request_read_error",
        details: error.message,
      },
      { status: 500 }
    );
  }
  if (!data) return jsonResponse({ ok: false, error: "visit_request_not_found" }, { status: 404 });

  return jsonResponse({
    ok: true,
    data,
    meta: {
      storage: "supabase.crm.portal_visit_requests",
    },
  });
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const visitRequestId = getVisitRequestId(params);
  if (!visitRequestId) return jsonResponse({ ok: false, error: "visit_request_id_required" }, { status: 400 });

  const body = await parseJsonBody<UpdateVisitRequestBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationId = asText(body.organization_id);
  const status = normalizeVisitStatus(body.status);
  const confirmedSlot = asText(body.confirmed_slot);
  const notes = asText(body.notes);
  const confirmedBy = asUuid(body.confirmed_by);

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: {
        id: visitRequestId,
        status,
        confirmed_slot: confirmedSlot,
      },
      meta: {
        persisted: false,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  let currentQuery = client
    .schema("crm")
    .from("portal_visit_requests")
    .select("*")
    .eq("id", visitRequestId)
    .maybeSingle();
  if (organizationId) currentQuery = currentQuery.eq("organization_id", organizationId);

  const { data: currentRow, error: currentError } = await currentQuery;
  if (currentError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_visit_request_read_error",
        details: currentError.message,
      },
      { status: 500 }
    );
  }
  if (!currentRow) return jsonResponse({ ok: false, error: "visit_request_not_found" }, { status: 404 });

  const nextConfirmedSlot = confirmedSlot ?? asText((currentRow as Record<string, unknown>).confirmed_slot);
  if ((status === "confirmed" || status === "done" || status === "no_show") && !nextConfirmedSlot) {
    return jsonResponse(
      {
        ok: false,
        error: "confirmed_slot_required_for_status",
      },
      { status: 422 }
    );
  }

  const payload: Record<string, unknown> = {
    status,
    notes: notes ?? asText((currentRow as Record<string, unknown>).notes),
  };
  if (nextConfirmedSlot) payload.confirmed_slot = nextConfirmedSlot;
  if (confirmedBy) payload.confirmed_by = confirmedBy;

  const { data: updatedRow, error: updateError } = await client
    .schema("crm")
    .from("portal_visit_requests")
    .update(payload)
    .eq("id", visitRequestId)
    .select("*")
    .single();

  if (updateError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_visit_request_update_error",
        details: updateError.message,
      },
      { status: 500 }
    );
  }

  if (status === "confirmed" || status === "done" || status === "no_show") {
    await safeInsertPortalAccessLog(client, {
      organization_id: String((updatedRow as Record<string, unknown>).organization_id),
      portal_account_id: asUuid((updatedRow as Record<string, unknown>).portal_account_id),
      lead_id: asUuid((updatedRow as Record<string, unknown>).lead_id),
      project_property_id: asUuid((updatedRow as Record<string, unknown>).project_property_id),
      event_type: "visit_confirmed",
      ip: getRequestIp(request),
      user_agent: getRequestUserAgent(request),
      metadata: {
        visit_request_id: visitRequestId,
        status,
      },
    });
  }

  return jsonResponse({
    ok: true,
    data: updatedRow,
    meta: {
      persisted: true,
      storage: "supabase.crm.portal_visit_requests",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
