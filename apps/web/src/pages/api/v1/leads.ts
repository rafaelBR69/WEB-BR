import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import {
  LEAD_KINDS,
  LEAD_OPERATION_INTERESTS,
  LEAD_ORIGIN_TYPES,
  LEAD_STATUSES,
  normalizeEmail,
  normalizeLeadKind,
  normalizeLeadOriginType,
  normalizeLeadStatus,
  normalizeOperationInterest,
  normalizePhone,
} from "@shared/leads/domain";
import {
  resolveDefaultLeadOrganizationId,
  resolvePublicPropertyLeadContext,
  sendPropertyLeadNotificationEmail,
} from "@shared/leads/publicPropertyLead";
import { asText, asUuid } from "@shared/portal/domain";
import { getSupabaseServerClient } from "@shared/supabase/server";

type LeadInterest = (typeof LEAD_OPERATION_INTERESTS)[number];
type LeadStatus = (typeof LEAD_STATUSES)[number];
type LeadOriginType = (typeof LEAD_ORIGIN_TYPES)[number];
type LeadKind = (typeof LEAD_KINDS)[number];

type CreateLeadBody = {
  organization_id?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  consent?: boolean;
  lang?: string;
  source?: string;
  operation_interest?: LeadInterest;
  status?: LeadStatus;
  origin_type?: LeadOriginType;
  lead_kind?: LeadKind;
  agency_id?: string;
  provider_id?: string;
  referred_contact_id?: string;
  discarded_reason?: string;
  property_legacy_code?: string;
  message?: string;
};

const MOCK_LEADS = [
  {
    id: "ld_1001",
    full_name: "Marta Ruiz",
    email: "marta@example.com",
    source: "web_form",
    origin_type: "website",
    lead_kind: "buyer",
    operation_interest: "sale",
    status: "new",
  },
  {
    id: "ld_1002",
    full_name: "Tom van Dijk",
    email: "tom@example.com",
    source: "agency_referral",
    origin_type: "agency",
    agency_id: "ag_201",
    lead_kind: "buyer",
    operation_interest: "rent",
    status: "in_process",
  },
  {
    id: "ld_1003",
    full_name: "Blue Coast Agency",
    email: "ops@bluecoast.agency",
    source: "partner_channel",
    origin_type: "agency",
    agency_id: "ag_202",
    lead_kind: "agency",
    operation_interest: "both",
    status: "discarded",
    discarded_reason: "outside_service_area",
  },
];

const hasOwn = (value: unknown, key: string) =>
  Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));

export const GET: APIRoute = async ({ url }) => {
  const status = url.searchParams.get("status");
  const operation = url.searchParams.get("operation");
  const originType = url.searchParams.get("origin_type");

  const data = MOCK_LEADS.filter((lead) => {
    if (status && lead.status !== status) return false;
    if (operation && lead.operation_interest !== operation) return false;
    if (originType && lead.origin_type !== originType) return false;
    return true;
  });

  return jsonResponse({
    ok: true,
    data,
    meta: {
      count: data.length,
      storage: "mock_in_memory",
      supports: {
        status: LEAD_STATUSES,
        origin_type: LEAD_ORIGIN_TYPES,
      },
      next_step: "connect_supabase_table_crm_leads",
    },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<CreateLeadBody>(request);
  if (!body) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_json_body",
      },
      { status: 400 }
    );
  }

  const fullName = asText(body.full_name);
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phone);
  const message = asText(body.message);
  const propertyLegacyCode = asText(body.property_legacy_code);
  const lang = asText(body.lang) ?? "es";
  const source = asText(body.source) ?? "web_form";
  const originType = normalizeLeadOriginType(asText(body.origin_type), "website");
  const leadKind = normalizeLeadKind(asText(body.lead_kind), "buyer");
  const operationInterest = normalizeOperationInterest(asText(body.operation_interest), "sale");
  const status = normalizeLeadStatus(asText(body.status), "new");

  if (originType === "agency" && !body.agency_id) {
    return jsonResponse({ ok: false, error: "agency_id_required_for_agency_origin" }, { status: 422 });
  }

  if (originType === "provider" && !body.provider_id) {
    return jsonResponse({ ok: false, error: "provider_id_required_for_provider_origin" }, { status: 422 });
  }

  if (body.agency_id && body.provider_id) {
    return jsonResponse({ ok: false, error: "agency_id_and_provider_id_are_mutually_exclusive" }, { status: 422 });
  }

  if (propertyLegacyCode) {
    if (!fullName) {
      return jsonResponse({ ok: false, error: "full_name_required" }, { status: 422 });
    }
    if (!email) {
      return jsonResponse({ ok: false, error: "email_required" }, { status: 422 });
    }
    if (body.consent !== true) {
      return jsonResponse({ ok: false, error: "consent_required" }, { status: 422 });
    }

    const organizationId = asText(body.organization_id) ?? resolveDefaultLeadOrganizationId();
    if (!organizationId) {
      return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
    }

    const referredContactId = hasOwn(body, "referred_contact_id") ? asUuid(body.referred_contact_id) : null;
    const agencyId = hasOwn(body, "agency_id") ? asUuid(body.agency_id) : null;
    const providerId = hasOwn(body, "provider_id") ? asUuid(body.provider_id) : null;

    if (hasOwn(body, "referred_contact_id") && body.referred_contact_id != null && !referredContactId) {
      return jsonResponse({ ok: false, error: "invalid_referred_contact_id" }, { status: 422 });
    }
    if (hasOwn(body, "agency_id") && body.agency_id != null && !agencyId) {
      return jsonResponse({ ok: false, error: "invalid_agency_id" }, { status: 422 });
    }
    if (hasOwn(body, "provider_id") && body.provider_id != null && !providerId) {
      return jsonResponse({ ok: false, error: "invalid_provider_id" }, { status: 422 });
    }

    const client = getSupabaseServerClient();
    if (!client) {
      return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    let propertyContext;
    try {
      propertyContext = await resolvePublicPropertyLeadContext(
        client,
        organizationId,
        propertyLegacyCode,
        lang,
        request
      );
    } catch (error) {
      return jsonResponse(
        {
          ok: false,
          error: "db_property_lookup_error",
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      );
    }

    if (!propertyContext) {
      return jsonResponse({ ok: false, error: "property_legacy_code_not_found" }, { status: 404 });
    }

    const insertedAt = new Date().toISOString();
    const rawPayload = {
      created_via: "website_property_schedule_visit",
      mapped: {
        full_name: fullName,
        email,
        phone,
        message,
        lang,
        consent: true,
        property_legacy_code: propertyContext.snapshot.propertyLegacyCode,
        property_record_type: propertyContext.snapshot.propertyRecordType,
        project_legacy_code: propertyContext.snapshot.projectLegacyCode,
        display_name: propertyContext.snapshot.displayName,
        cover_url: propertyContext.snapshot.coverUrl,
        price: propertyContext.snapshot.price,
        currency: propertyContext.snapshot.currency,
        public_url: propertyContext.snapshot.publicUrl,
      },
      project: {
        property_id: propertyContext.propertyId,
        property_legacy_code: propertyContext.propertyLegacyCode,
        property_record_type: propertyContext.propertyRecordType,
        project_id: propertyContext.projectId,
        project_legacy_code: propertyContext.projectLegacyCode,
      },
      notification: {
        routing_source: propertyContext.routingSource,
        recipients: propertyContext.recipients,
      },
      import: {
        channel: source,
        imported_at: insertedAt,
      },
    };

    const insertPayload: Record<string, unknown> = {
      organization_id: organizationId,
      property_id: propertyContext.propertyId,
      agency_id: agencyId,
      provider_id: providerId,
      referred_contact_id: referredContactId,
      lead_kind: leadKind,
      origin_type: originType,
      source,
      status,
      operation_interest: operationInterest,
      discarded_reason: body.discarded_reason ?? null,
      discarded_at: status === "discarded" ? insertedAt : null,
      raw_payload: rawPayload,
    };

    const { data: insertedLead, error: insertError } = await client
      .schema("crm")
      .from("leads")
      .insert(insertPayload)
      .select("id, organization_id, property_id, lead_kind, origin_type, source, status, operation_interest, created_at")
      .single();

    if (insertError || !insertedLead) {
      return jsonResponse(
        {
          ok: false,
          error: "db_lead_insert_error",
          details: insertError?.message ?? "insert_lead_failed",
        },
        { status: 500 }
      );
    }

    const leadId = asText((insertedLead as Record<string, unknown>).id) ?? "";
    const emailDelivery = await sendPropertyLeadNotificationEmail({
      request,
      to: propertyContext.recipients,
      leadId,
      fullName,
      email,
      phone,
      message,
      snapshot: propertyContext.snapshot,
      projectDisplayName: propertyContext.projectDisplayName,
    });

    if (!emailDelivery.sent) {
      console.error("[property-lead-email] delivery_failed", {
        leadId,
        propertyLegacyCode: propertyContext.propertyLegacyCode,
        projectLegacyCode: propertyContext.projectLegacyCode,
        error: emailDelivery.error,
        recipientCount: emailDelivery.recipientCount,
      });
    }

    return jsonResponse(
      {
        ok: true,
        data: {
          id: leadId,
          organization_id: asText((insertedLead as Record<string, unknown>).organization_id),
          property_id: asText((insertedLead as Record<string, unknown>).property_id),
          property_legacy_code: propertyContext.propertyLegacyCode,
          project_legacy_code: propertyContext.projectLegacyCode,
          full_name: fullName,
          email,
          phone,
          message,
          source,
          origin_type: originType,
          lead_kind: leadKind,
          operation_interest: operationInterest,
          status,
          created_at: asText((insertedLead as Record<string, unknown>).created_at),
        },
        meta: {
          persisted: true,
          storage: "supabase.crm.leads",
          email_delivery: emailDelivery,
        },
      },
      { status: 201 }
    );
  }

  if (!fullName) {
    return jsonResponse({ ok: false, error: "full_name_required" }, { status: 422 });
  }

  if (!email && !phone) {
    return jsonResponse({ ok: false, error: "email_or_phone_required" }, { status: 422 });
  }

  const leadId = `ld_${crypto.randomUUID()}`;
  return jsonResponse(
    {
      ok: true,
      data: {
        id: leadId,
        organization_id: body.organization_id ?? null,
        full_name: fullName,
        email: email || null,
        phone: phone || null,
        source,
        origin_type: originType,
        lead_kind: leadKind,
        agency_id: body.agency_id ?? null,
        provider_id: body.provider_id ?? null,
        referred_contact_id: body.referred_contact_id ?? null,
        operation_interest: operationInterest,
        property_legacy_code: null,
        message: message ?? null,
        status,
        discarded_reason: body.discarded_reason ?? null,
        discarded_at: status === "discarded" ? new Date().toISOString() : null,
        created_at: new Date().toISOString(),
      },
      meta: {
        persisted: false,
        next_step: "insert_into_crm_leads_in_supabase",
      },
    },
    { status: 201 }
  );
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
