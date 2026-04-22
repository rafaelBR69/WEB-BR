import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { LEAD_KINDS, LEAD_OPERATION_INTERESTS, LEAD_ORIGIN_TYPES, LEAD_STATUSES } from "@shared/leads/domain";
import {
  PUBLIC_LEAD_LOG_SOURCE,
  PUBLIC_LEAD_RATE_LIMITS,
  checkPublicLeadRateLimit,
  normalizePublicLeadRateLimitPhone,
} from "@shared/leads/publicLeadRateLimit";
import {
  classifyPublicLeadContent,
  evaluatePublicLeadTechnicalGuard,
  parsePublicLeadBody,
} from "@shared/leads/publicLeadSpamGuard";
import {
  resolveDefaultLeadOrganizationId,
  resolvePublicPropertyLeadContext,
  sendGenericLeadNotificationEmail,
  sendPropertyLeadNotificationEmail,
} from "@shared/leads/publicPropertyLead";
import {
  asText,
  getRequestIp,
  getRequestUserAgent,
  safeInsertPortalAccessLog,
} from "@shared/portal/domain";
import { getSupabaseServerClient } from "@shared/supabase/server";

const DEFAULT_GENERIC_LEAD_RECIPIENTS = ["info@blancareal.com", "sales@blancareal.com"];
const LEAD_INSERT_SELECT_COLUMNS = [
  "id",
  "organization_id",
  "property_id",
  "lead_kind",
  "origin_type",
  "source",
  "status",
  "operation_interest",
  "created_at",
].join(", ");

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

type EmailDeliveryResult = {
  attempted: boolean;
  sent: boolean;
  provider: string | null;
  error: string | null;
  recipientCount: number;
};

const buildSkippedEmailDelivery = (): EmailDeliveryResult => ({
  attempted: false,
  sent: false,
  provider: null,
  error: null,
  recipientCount: 0,
});

const buildBlockedResponse = (status = 400, error = "submission_blocked") =>
  jsonResponse(
    {
      ok: false,
      error,
    },
    { status }
  );

const buildSpamGuardSnapshot = (input: {
  verdict: "blocked" | "junk" | "new";
  reasons: string[];
  ip: string | null;
  userAgent: string | null;
  renderMs: number | null;
  websiteForm: string;
  turnstileOk: boolean;
}) => ({
  verdict: input.verdict,
  reasons: input.reasons,
  ip: input.ip,
  user_agent: input.userAgent,
  render_ms: input.renderMs,
  website_form: input.websiteForm,
  turnstile_ok: input.turnstileOk,
});

const buildPublicLeadLogMetadata = (input: {
  verdict: "blocked" | "junk" | "new";
  reasons: string[];
  websiteForm: string;
  ip: string | null;
  userAgent: string | null;
  renderMs: number | null;
  turnstileOk: boolean;
  email: string | null;
  phone: string | null;
  hpField: string | null;
  extra?: Record<string, unknown>;
}) => ({
  source: PUBLIC_LEAD_LOG_SOURCE,
  website_form: input.websiteForm,
  verdict: input.verdict,
  reasons: input.reasons,
  ip: input.ip,
  user_agent: input.userAgent,
  render_ms: input.renderMs,
  turnstile_ok: input.turnstileOk,
  email_normalized: input.email,
  phone_normalized: normalizePublicLeadRateLimitPhone(input.phone),
  hp_present: Boolean(input.hpField),
  hp_length: input.hpField?.length ?? 0,
  ...input.extra,
});

const insertPublicLead = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  insertPayload: Record<string, unknown>
) => {
  const { data, error } = await client
    .schema("crm")
    .from("leads")
    .insert(insertPayload)
    .select(LEAD_INSERT_SELECT_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "insert_lead_failed");
  }

  return data as unknown as Record<string, unknown>;
};

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
        lead_kind: LEAD_KINDS,
        operation_interest: LEAD_OPERATION_INTERESTS,
      },
      next_step: "connect_supabase_table_crm_leads",
    },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<Record<string, unknown>>(request);
  if (!body) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_json_body",
      },
      { status: 400 }
    );
  }

  const parsed = parsePublicLeadBody(body);
  if (!parsed.ok) {
    return jsonResponse({ ok: false, error: parsed.error }, { status: 422 });
  }

  const payload = parsed.data;
  const organizationId = resolveDefaultLeadOrganizationId();
  if (!organizationId) {
    return jsonResponse({ ok: false, error: "lead_organization_not_configured" }, { status: 500 });
  }

  const client = getSupabaseServerClient();
  if (!client) {
    return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });
  }

  const ip = getRequestIp(request);
  const userAgent = getRequestUserAgent(request);
  const technicalGuard = await evaluatePublicLeadTechnicalGuard({
    payload,
    ip,
  });

  if (technicalGuard.blocked) {
    await safeInsertPortalAccessLog(client, {
      organization_id: organizationId,
      email: payload.email,
      event_type: "blocked",
      ip,
      user_agent: userAgent,
      metadata: buildPublicLeadLogMetadata({
        verdict: "blocked",
        reasons: technicalGuard.reasons,
        websiteForm: payload.websiteForm,
        ip,
        userAgent,
        renderMs: technicalGuard.renderMs,
        turnstileOk: technicalGuard.turnstileOk,
        email: payload.email,
        phone: payload.phone,
        hpField: payload.hpField,
      }),
    });

    return buildBlockedResponse();
  }

  const rateLimit = await checkPublicLeadRateLimit(client, {
    organizationId,
    ip,
    email: payload.email,
    phone: payload.phone,
  });

  if (rateLimit.blocked) {
    await safeInsertPortalAccessLog(client, {
      organization_id: organizationId,
      email: payload.email,
      event_type: "blocked",
      ip,
      user_agent: userAgent,
      metadata: buildPublicLeadLogMetadata({
        verdict: "blocked",
        reasons: rateLimit.reasons,
        websiteForm: payload.websiteForm,
        ip,
        userAgent,
        renderMs: technicalGuard.renderMs,
        turnstileOk: technicalGuard.turnstileOk,
        email: payload.email,
        phone: payload.phone,
        hpField: payload.hpField,
        extra: {
          rate_limit_counts: rateLimit.counts,
          rate_limit_limits: {
            ip: PUBLIC_LEAD_RATE_LIMITS.ip.attempts,
            email: PUBLIC_LEAD_RATE_LIMITS.email.attempts,
            phone: PUBLIC_LEAD_RATE_LIMITS.phone.attempts,
          },
        },
      }),
    });

    return buildBlockedResponse(429, "too_many_requests");
  }

  const fullName = payload.fullName;
  const email = payload.email;
  const phone = payload.phone;
  const message = payload.message;
  const lang = payload.lang ?? "es";
  const source = payload.source;
  const leadKind = payload.leadKind;
  const operationInterest = payload.operationInterest;
  const propertyLegacyCode = payload.propertyLegacyCode;

  if (!fullName) {
    return jsonResponse({ ok: false, error: "full_name_required" }, { status: 422 });
  }

  if (payload.consent !== true) {
    return jsonResponse({ ok: false, error: "consent_required" }, { status: 422 });
  }

  if (payload.websiteForm === "property") {
    if (!email) {
      return jsonResponse({ ok: false, error: "email_required" }, { status: 422 });
    }
    if (!propertyLegacyCode) {
      return jsonResponse({ ok: false, error: "property_legacy_code_required" }, { status: 422 });
    }
  } else if (!email && !phone) {
    return jsonResponse({ ok: false, error: "email_or_phone_required" }, { status: 422 });
  }

  const contentGuard = classifyPublicLeadContent({
    fullName,
    email,
    message,
  });

  const leadStatus = contentGuard.verdict === "junk" ? "junk" : "new";
  const discardedReason = leadStatus === "junk" ? "spam_guard_gibberish" : null;
  const insertedAt = new Date().toISOString();
  const spamGuardSnapshot = buildSpamGuardSnapshot({
    verdict: contentGuard.verdict,
    reasons: contentGuard.reasons,
    ip,
    userAgent,
    renderMs: technicalGuard.renderMs,
    websiteForm: payload.websiteForm,
    turnstileOk: technicalGuard.turnstileOk,
  });
  const logMetadata = buildPublicLeadLogMetadata({
    verdict: contentGuard.verdict,
    reasons: contentGuard.reasons,
    websiteForm: payload.websiteForm,
    ip,
    userAgent,
    renderMs: technicalGuard.renderMs,
    turnstileOk: technicalGuard.turnstileOk,
    email,
    phone,
    hpField: payload.hpField,
  });

  if (payload.websiteForm === "property") {
    let propertyContext;
    try {
      propertyContext = await resolvePublicPropertyLeadContext(
        client,
        organizationId,
        propertyLegacyCode ?? "",
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
      spam_guard: spamGuardSnapshot,
    };

    let insertedLead;
    try {
      insertedLead = await insertPublicLead(client, {
        organization_id: organizationId,
        property_id: propertyContext.propertyId,
        lead_kind: leadKind,
        origin_type: "website",
        source,
        status: leadStatus,
        operation_interest: operationInterest,
        discarded_reason: discardedReason,
        discarded_at: discardedReason ? insertedAt : null,
        raw_payload: rawPayload,
      });
    } catch (error) {
      return jsonResponse(
        {
          ok: false,
          error: "db_lead_insert_error",
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      );
    }

    const leadId = asText(insertedLead.id) ?? "";

    await safeInsertPortalAccessLog(client, {
      organization_id: organizationId,
      lead_id: leadId,
      email,
      event_type: "lead_submitted",
      ip,
      user_agent: userAgent,
      metadata: logMetadata,
    });

    let emailDelivery = buildSkippedEmailDelivery();
    if (leadStatus === "new") {
      emailDelivery = await sendPropertyLeadNotificationEmail({
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
    }

    return jsonResponse(
      {
        ok: true,
        data: {
          id: leadId,
          organization_id: asText(insertedLead.organization_id),
          property_id: asText(insertedLead.property_id),
          property_legacy_code: propertyContext.propertyLegacyCode,
          project_legacy_code: propertyContext.projectLegacyCode,
          full_name: fullName,
          email,
          phone,
          message,
          source,
          origin_type: "website",
          lead_kind: leadKind,
          operation_interest: operationInterest,
          status: leadStatus,
          discarded_reason: discardedReason,
          discarded_at: discardedReason ? insertedAt : null,
          created_at: asText(insertedLead.created_at),
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

  const rawPayload = {
    created_via: `website_${payload.websiteForm}_form`,
    mapped: {
      full_name: fullName,
      email,
      phone,
      message,
      lang,
      consent: true,
    },
    notification: {
      routing_source: "generic",
      recipients: DEFAULT_GENERIC_LEAD_RECIPIENTS,
    },
    import: {
      channel: source,
      imported_at: insertedAt,
    },
    spam_guard: spamGuardSnapshot,
  };

  let insertedLead;
  try {
    insertedLead = await insertPublicLead(client, {
      organization_id: organizationId,
      lead_kind: leadKind,
      origin_type: "website",
      source,
      status: leadStatus,
      operation_interest: operationInterest,
      discarded_reason: discardedReason,
      discarded_at: discardedReason ? insertedAt : null,
      raw_payload: rawPayload,
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_lead_insert_error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }

  const leadId = asText(insertedLead.id) ?? "";

  await safeInsertPortalAccessLog(client, {
    organization_id: organizationId,
    lead_id: leadId,
    email,
    event_type: "lead_submitted",
    ip,
    user_agent: userAgent,
    metadata: logMetadata,
  });

  let emailDelivery = buildSkippedEmailDelivery();
  if (leadStatus === "new") {
    emailDelivery = await sendGenericLeadNotificationEmail({
      to: DEFAULT_GENERIC_LEAD_RECIPIENTS,
      leadId,
      fullName,
      email: email || null,
      phone: phone || null,
      message: message ?? null,
      source,
      leadKind,
      operationInterest,
      lang,
    });

    if (!emailDelivery.sent) {
      console.error("[generic-lead-email] delivery_failed", {
        leadId,
        source,
        error: emailDelivery.error,
        recipientCount: emailDelivery.recipientCount,
      });
    }
  }

  return jsonResponse(
    {
      ok: true,
      data: {
        id: leadId,
        organization_id: asText(insertedLead.organization_id),
        property_id: asText(insertedLead.property_id),
        full_name: fullName,
        email: email || null,
        phone: phone || null,
        source,
        origin_type: "website",
        lead_kind: leadKind,
        operation_interest: operationInterest,
        property_legacy_code: null,
        message: message ?? null,
        status: leadStatus,
        discarded_reason: discardedReason,
        discarded_at: discardedReason ? insertedAt : null,
        created_at: asText(insertedLead.created_at),
      },
      meta: {
        persisted: true,
        storage: "supabase.crm.leads",
        email_delivery: emailDelivery,
      },
    },
    { status: 201 }
  );
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
