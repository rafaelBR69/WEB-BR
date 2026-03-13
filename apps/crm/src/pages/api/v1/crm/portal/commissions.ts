import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@shared/supabase/server";
import { CRM_EDITOR_ROLES, resolveCrmOrgAccess } from "@shared/crm/access";
import {
  asText,
  asUuid,
  toPositiveInt,
  asNumber,
  asObject,
  safeInsertPortalAccessLog,
} from "@shared/portal/domain";

type CommissionStatus = "pending" | "approved" | "paid" | "cancelled";
type CommissionType = "percent" | "fixed";

type PatchCommissionBody = {
  organization_id?: string;
  id?: string;
  status?: CommissionStatus;
  commission_type?: CommissionType;
  commission_value?: number | null;
  currency?: string | null;
  payment_date?: string | null;
  notes?: string | null;
};

const asCommissionStatus = (value: unknown): CommissionStatus | null => {
  if (value === "pending" || value === "approved" || value === "paid" || value === "cancelled") {
    return value;
  }
  return null;
};

const asCommissionType = (value: unknown): CommissionType | null => {
  if (value === "percent" || value === "fixed") return value;
  return null;
};

const normalizeDateOnly = (value: unknown): string | null => {
  const text = asText(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
};

const asNonNegativeNumber = (value: unknown): number | null => {
  const parsed = asNumber(value);
  if (parsed == null) return null;
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

const mapCommissionRow = (
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
    deal_id: asText(row.deal_id),
    project_property_id: asText(row.project_property_id),
    portal_account_id: asText(row.portal_account_id),
    commission_type: asCommissionType(row.commission_type) ?? "fixed",
    commission_value: asNumber(row.commission_value),
    currency: asText(row.currency) ?? "EUR",
    status: asCommissionStatus(row.status) ?? "pending",
    payment_date: asText(row.payment_date),
    notes: asText(row.notes),
    metadata: asObject(row.metadata),
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
  const dealId = asUuid(url.searchParams.get("deal_id"));
  const status = asCommissionStatus(asText(url.searchParams.get("status")));
  const type = asCommissionType(asText(url.searchParams.get("commission_type")));
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
    .from("portal_commission_status")
    .select("*", { count: "exact" })
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (id) query = query.eq("id", id);
  if (projectId) query = query.eq("project_property_id", projectId);
  if (portalAccountId) query = query.eq("portal_account_id", portalAccountId);
  if (leadId) query = query.eq("lead_id", leadId);
  if (dealId) query = query.eq("deal_id", dealId);
  if (status) query = query.eq("status", status);
  if (type) query = query.eq("commission_type", type);

  const { data, error, count } = await query;
  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_commissions_read_error",
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
    .map((row) => mapCommissionRow(row, leadById, contactById))
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
      storage: "supabase.crm.portal_commission_status",
    },
  });
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const body = await parseJsonBody<PatchCommissionBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationId = asText(body.organization_id);
  const commissionId = asUuid(body.id);
  const status = body.status != null ? asCommissionStatus(body.status) : null;
  const commissionType = body.commission_type != null ? asCommissionType(body.commission_type) : null;
  const commissionValue =
    body.commission_value == null ? null : asNonNegativeNumber(body.commission_value);
  const currency = body.currency == null ? null : asText(body.currency);
  const paymentDate = body.payment_date == null ? null : normalizeDateOnly(body.payment_date);
  const notes = body.notes == null ? null : asText(body.notes);

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (!commissionId) return jsonResponse({ ok: false, error: "commission_id_required" }, { status: 422 });
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
  if (body.commission_type != null && !commissionType) {
    return jsonResponse({ ok: false, error: "invalid_commission_type" }, { status: 422 });
  }
  if (body.commission_value != null && commissionValue == null) {
    return jsonResponse({ ok: false, error: "invalid_commission_value" }, { status: 422 });
  }
  if (body.currency != null && !currency) return jsonResponse({ ok: false, error: "invalid_currency" }, { status: 422 });
  if (body.payment_date != null && !paymentDate) {
    return jsonResponse({ ok: false, error: "invalid_payment_date" }, { status: 422 });
  }

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: {
        id: commissionId,
        organization_id: organizationId,
        status: status ?? "pending",
        commission_type: commissionType ?? "fixed",
        commission_value: commissionValue,
        currency: currency ?? "EUR",
        payment_date: paymentDate,
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
    .from("portal_commission_status")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", commissionId)
    .maybeSingle();

  if (currentError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_commission_read_error",
        details: currentError.message,
      },
      { status: 500 }
    );
  }
  if (!currentRow) return jsonResponse({ ok: false, error: "commission_not_found" }, { status: 404 });

  const current = currentRow as Record<string, unknown>;
  const nextStatus = status ?? (asCommissionStatus(current.status) ?? "pending");

  const payload: Record<string, unknown> = {};
  if (status) payload.status = status;
  if (commissionType) payload.commission_type = commissionType;
  if (body.commission_value != null) payload.commission_value = commissionValue;
  if (body.currency != null) payload.currency = currency;
  if (body.payment_date != null) payload.payment_date = paymentDate;
  if (body.notes != null) payload.notes = notes;

  if (nextStatus === "paid" && !payload.payment_date && !asText(current.payment_date)) {
    payload.payment_date = new Date().toISOString().slice(0, 10);
  }

  if (!Object.keys(payload).length) {
    return jsonResponse({ ok: false, error: "no_fields_to_update" }, { status: 422 });
  }

  const { data: updated, error: updateError } = await client
    .schema("crm")
    .from("portal_commission_status")
    .update(payload)
    .eq("organization_id", organizationId)
    .eq("id", commissionId)
    .select("*")
    .single();

  if (updateError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_commission_update_error",
        details: updateError.message,
      },
      { status: 500 }
    );
  }

  const row = updated as Record<string, unknown>;
  await safeInsertPortalAccessLog(client, {
    organization_id: organizationId,
    portal_account_id: asUuid(row.portal_account_id),
    lead_id: asUuid(row.lead_id),
    project_property_id: asUuid(row.project_property_id),
    event_type: "commission_updated",
    metadata: {
      commission_id: commissionId,
      previous_status: asCommissionStatus(current.status),
      next_status: nextStatus,
    },
  });

  return jsonResponse({
    ok: true,
    data: updated,
    meta: {
      persisted: true,
      storage: "supabase.crm.portal_commission_status",
    },
  });
};

export const POST: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "PATCH"]);
