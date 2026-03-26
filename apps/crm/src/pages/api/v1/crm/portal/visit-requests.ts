import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@shared/supabase/server";
import { CRM_EDITOR_ROLES, resolveCrmOrgAccess } from "@shared/crm/access";
import { isPortalMockFallbackEnabled, portalMockFallbackDisabledResponse } from "@shared/http/portal/mockFallback";
import {
  asText,
  asUuid,
  toPositiveInt,
  safeInsertPortalAccessLog,
  asObject,
} from "@shared/portal/domain";

type VisitRequestStatus = "requested" | "confirmed" | "declined" | "done" | "no_show" | "cancelled";

type PatchVisitRequestBody = {
  organization_id?: string;
  id?: string;
  status?: VisitRequestStatus;
  confirmed_slot?: string | null;
  notes?: string | null;
  confirmed_by?: string | null;
};

const asVisitRequestStatus = (value: unknown): VisitRequestStatus | null => {
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
  return null;
};

const normalizeIsoDateTime = (value: unknown): string | null => {
  const text = asText(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const mapVisitRow = (
  row: Record<string, unknown>,
  leadById: Map<string, Record<string, unknown>>,
  contactById: Map<string, Record<string, unknown>>
) => {
  const leadId = asUuid(row.lead_id);
  const lead = leadId ? leadById.get(leadId) ?? null : null;
  const contactId = lead ? asUuid((lead as Record<string, unknown>).contact_id) : null;
  const contact = contactId ? contactById.get(contactId) ?? null : null;
  const contactName = asText(contact?.full_name);
  const contactEmail = asText(contact?.email);
  const contactPhone = asText(contact?.phone);

  return {
    id: asText(row.id),
    organization_id: asText(row.organization_id),
    lead_id: asText(row.lead_id),
    project_property_id: asText(row.project_property_id),
    portal_account_id: asText(row.portal_account_id),
    request_mode: asText(row.request_mode),
    proposed_slots: Array.isArray(row.proposed_slots) ? row.proposed_slots : [],
    confirmed_slot: asText(row.confirmed_slot),
    status: asVisitRequestStatus(row.status) ?? "requested",
    notes: asText(row.notes),
    confirmed_by: asText(row.confirmed_by),
    created_at: asText(row.created_at),
    updated_at: asText(row.updated_at),
    lead_summary: {
      reference_code: asText(lead?.reference_code),
      status: asText(lead?.status),
      contact_name: contactName,
      contact_email: contactEmail,
      contact_phone: contactPhone,
      label: contactName ?? contactEmail ?? contactPhone ?? asText(lead?.reference_code) ?? "Lead",
    },
  };
};

export const GET: APIRoute = async ({ url, cookies }) => {
  const organizationId = asText(url.searchParams.get("organization_id"));
  const id = asUuid(url.searchParams.get("id"));
  const projectId = asUuid(url.searchParams.get("project_property_id"));
  const portalAccountId = asUuid(url.searchParams.get("portal_account_id"));
  const leadId = asUuid(url.searchParams.get("lead_id"));
  const status = asVisitRequestStatus(asText(url.searchParams.get("status")));
  const fromDate = asText(url.searchParams.get("from"));
  const toDate = asText(url.searchParams.get("to"));
  const q = asText(url.searchParams.get("q"))?.toLowerCase() ?? "";
  const page = toPositiveInt(url.searchParams.get("page"), 1, 1, 10000);
  const perPage = toPositiveInt(url.searchParams.get("per_page"), 25, 1, 200);

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint: organizationId,
    allowedPermissions: ["crm.portal.read"],
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
        "portal_visit_requests_backend_unavailable",
        "Activa Supabase o habilita CRM_ENABLE_MOCK_FALLBACKS=true solo en desarrollo para usar mocks."
      );
    }
    return jsonResponse({
      ok: true,
      data: [],
      meta: {
        count: 0,
        total: 0,
        page,
        per_page: perPage,
        total_pages: 1,
        persisted: false,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let query = client
    .schema("crm")
    .from("portal_visit_requests")
    .select("*", { count: "exact" })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (id) query = query.eq("id", id);
  if (projectId) query = query.eq("project_property_id", projectId);
  if (portalAccountId) query = query.eq("portal_account_id", portalAccountId);
  if (leadId) query = query.eq("lead_id", leadId);
  if (status) query = query.eq("status", status);
  if (fromDate) query = query.gte("created_at", fromDate);
  if (toDate) query = query.lte("created_at", toDate);

  const { data, error, count } = await query;
  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_visit_requests_read_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const leadIds = Array.from(
    new Set(
      rows
        .map((entry) => asUuid(entry.lead_id))
        .filter((value): value is string => Boolean(value))
    )
  );

  const leadById = new Map<string, Record<string, unknown>>();
  const contactById = new Map<string, Record<string, unknown>>();

  if (leadIds.length) {
    const { data: leadsRows, error: leadsError } = await client
      .schema("crm")
      .from("leads")
      .select("id, organization_id, contact_id, reference_code, status")
      .eq("organization_id", organizationId)
      .in("id", leadIds);

    if (leadsError) {
      return jsonResponse(
        {
          ok: false,
          error: "db_leads_read_error",
          details: leadsError.message,
        },
        { status: 500 }
      );
    }

    (leadsRows ?? []).forEach((row) => {
      const key = asUuid((row as Record<string, unknown>).id);
      if (!key) return;
      leadById.set(key, row as Record<string, unknown>);
    });

    const contactIds = Array.from(
      new Set(
        (leadsRows ?? [])
          .map((row) => asUuid((row as Record<string, unknown>).contact_id))
          .filter((value): value is string => Boolean(value))
      )
    );

    if (contactIds.length) {
      const { data: contactRows, error: contactError } = await client
        .schema("crm")
        .from("contacts")
        .select("id, organization_id, full_name, email, phone")
        .eq("organization_id", organizationId)
        .in("id", contactIds);

      if (contactError) {
        return jsonResponse(
          {
            ok: false,
            error: "db_contacts_read_error",
            details: contactError.message,
          },
          { status: 500 }
        );
      }

      (contactRows ?? []).forEach((row) => {
        const key = asUuid((row as Record<string, unknown>).id);
        if (!key) return;
        contactById.set(key, row as Record<string, unknown>);
      });
    }
  }

  const mapped = rows
    .map((row) => mapVisitRow(row, leadById, contactById))
    .filter((row) => {
      if (!q) return true;
      const summary = asObject(row.lead_summary);
      const composed = `${row.status ?? ""} ${summary.label ?? ""} ${summary.contact_email ?? ""} ${
        summary.reference_code ?? ""
      }`.toLowerCase();
      return composed.includes(q);
    });

  const total = typeof count === "number" ? count : mapped.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return jsonResponse({
    ok: true,
    data: mapped,
    meta: {
      count: mapped.length,
      total,
      page,
      per_page: perPage,
      total_pages: totalPages,
      storage: "supabase.crm.portal_visit_requests",
    },
  });
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const body = await parseJsonBody<PatchVisitRequestBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationId = asText(body.organization_id);
  const visitRequestId = asUuid(body.id);
  const status = body.status ? asVisitRequestStatus(body.status) : null;
  const confirmedSlot = normalizeIsoDateTime(body.confirmed_slot);
  const notes = body.notes == null ? null : asText(body.notes);
  const confirmedBy = body.confirmed_by == null ? null : asUuid(body.confirmed_by);

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (!visitRequestId) return jsonResponse({ ok: false, error: "visit_request_id_required" }, { status: 422 });
  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint: organizationId,
    allowedRoles: CRM_EDITOR_ROLES,
    allowedPermissions: ["crm.portal.write"],
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
  if (body.status != null && !status) return jsonResponse({ ok: false, error: "invalid_status" }, { status: 422 });
  if (body.confirmed_slot != null && !confirmedSlot) {
    return jsonResponse({ ok: false, error: "invalid_confirmed_slot" }, { status: 422 });
  }
  if (body.confirmed_by != null && !confirmedBy) {
    return jsonResponse({ ok: false, error: "invalid_confirmed_by" }, { status: 422 });
  }

  if (!hasSupabaseServerClient()) {
    if (!isPortalMockFallbackEnabled()) {
      return portalMockFallbackDisabledResponse(
        "portal_visit_requests_backend_unavailable",
        "Activa Supabase o habilita CRM_ENABLE_MOCK_FALLBACKS=true solo en desarrollo para usar mocks."
      );
    }
    return jsonResponse({
      ok: true,
      data: {
        id: visitRequestId,
        organization_id: organizationId,
        status: status ?? "requested",
        confirmed_slot: confirmedSlot,
        notes,
      },
      meta: {
        persisted: false,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const { data: currentRow, error: currentError } = await client
    .schema("crm")
    .from("portal_visit_requests")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", visitRequestId)
    .maybeSingle();

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

  const current = currentRow as Record<string, unknown>;
  const nextStatus = status ?? (asVisitRequestStatus(current.status) ?? "requested");
  const nextConfirmedSlot = confirmedSlot ?? asText(current.confirmed_slot);

  if ((nextStatus === "confirmed" || nextStatus === "done" || nextStatus === "no_show") && !nextConfirmedSlot) {
    return jsonResponse(
      {
        ok: false,
        error: "confirmed_slot_required_for_status",
      },
      { status: 422 }
    );
  }

  const payload: Record<string, unknown> = {};
  if (status) payload.status = status;
  if (confirmedSlot) payload.confirmed_slot = confirmedSlot;
  if (body.notes != null) payload.notes = notes;
  if (body.confirmed_by != null) payload.confirmed_by = confirmedBy;

  if (!Object.keys(payload).length) {
    return jsonResponse({ ok: false, error: "no_fields_to_update" }, { status: 422 });
  }

  const { data: updated, error: updateError } = await client
    .schema("crm")
    .from("portal_visit_requests")
    .update(payload)
    .eq("organization_id", organizationId)
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

  if (nextStatus === "confirmed" || nextStatus === "done" || nextStatus === "no_show") {
    const row = updated as Record<string, unknown>;
    await safeInsertPortalAccessLog(client, {
      organization_id: organizationId,
      portal_account_id: asUuid(row.portal_account_id),
      lead_id: asUuid(row.lead_id),
      project_property_id: asUuid(row.project_property_id),
      event_type: "visit_confirmed",
      metadata: {
        visit_request_id: visitRequestId,
        previous_status: asVisitRequestStatus(current.status),
        next_status: nextStatus,
      },
    });
  }

  return jsonResponse({
    ok: true,
    data: updated,
    meta: {
      persisted: true,
      storage: "supabase.crm.portal_visit_requests",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
