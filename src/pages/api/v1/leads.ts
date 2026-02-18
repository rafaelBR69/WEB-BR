import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";

type LeadInterest = "sale" | "rent" | "both";
type LeadStatus =
  | "new"
  | "in_process"
  | "qualified"
  | "visit_scheduled"
  | "offer_sent"
  | "negotiation"
  | "converted"
  | "won"
  | "lost"
  | "discarded"
  | "junk";
type LeadOriginType =
  | "direct"
  | "website"
  | "portal"
  | "agency"
  | "provider"
  | "phone"
  | "whatsapp"
  | "email"
  | "other";
type LeadKind = "buyer" | "seller" | "landlord" | "tenant" | "investor" | "agency" | "provider" | "other";

type CreateLeadBody = {
  organization_id?: string;
  full_name?: string;
  email?: string;
  phone?: string;
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

const normalizeInterest = (value: unknown): LeadInterest => {
  if (value === "sale" || value === "rent" || value === "both") return value;
  return "sale";
};

const normalizeLeadStatus = (value: unknown): LeadStatus => {
  const accepted: LeadStatus[] = [
    "new",
    "in_process",
    "qualified",
    "visit_scheduled",
    "offer_sent",
    "negotiation",
    "converted",
    "won",
    "lost",
    "discarded",
    "junk",
  ];
  if (typeof value === "string" && accepted.includes(value as LeadStatus)) {
    return value as LeadStatus;
  }
  return "new";
};

const normalizeOriginType = (value: unknown): LeadOriginType => {
  const accepted: LeadOriginType[] = [
    "direct",
    "website",
    "portal",
    "agency",
    "provider",
    "phone",
    "whatsapp",
    "email",
    "other",
  ];
  if (typeof value === "string" && accepted.includes(value as LeadOriginType)) {
    return value as LeadOriginType;
  }
  return "website";
};

const normalizeLeadKind = (value: unknown): LeadKind => {
  const accepted: LeadKind[] = [
    "buyer",
    "seller",
    "landlord",
    "tenant",
    "investor",
    "agency",
    "provider",
    "other",
  ];
  if (typeof value === "string" && accepted.includes(value as LeadKind)) {
    return value as LeadKind;
  }
  return "buyer";
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
        status: [
          "new",
          "in_process",
          "qualified",
          "visit_scheduled",
          "offer_sent",
          "negotiation",
          "converted",
          "won",
          "lost",
          "discarded",
          "junk",
        ],
        origin_type: ["direct", "website", "portal", "agency", "provider", "phone", "whatsapp", "email", "other"],
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

  const fullName = String(body.full_name ?? "").trim();
  const email = String(body.email ?? "").trim();
  const phone = String(body.phone ?? "").trim();

  if (!fullName) {
    return jsonResponse(
      {
        ok: false,
        error: "full_name_required",
      },
      { status: 422 }
    );
  }

  if (!email && !phone) {
    return jsonResponse(
      {
        ok: false,
        error: "email_or_phone_required",
      },
      { status: 422 }
    );
  }

  const originType = normalizeOriginType(body.origin_type);
  if (originType === "agency" && !body.agency_id) {
    return jsonResponse(
      {
        ok: false,
        error: "agency_id_required_for_agency_origin",
      },
      { status: 422 }
    );
  }

  if (originType === "provider" && !body.provider_id) {
    return jsonResponse(
      {
        ok: false,
        error: "provider_id_required_for_provider_origin",
      },
      { status: 422 }
    );
  }

  if (body.agency_id && body.provider_id) {
    return jsonResponse(
      {
        ok: false,
        error: "agency_id_and_provider_id_are_mutually_exclusive",
      },
      { status: 422 }
    );
  }

  const status = normalizeLeadStatus(body.status);

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
        source: body.source ?? "web_form",
        origin_type: originType,
        lead_kind: normalizeLeadKind(body.lead_kind),
        agency_id: body.agency_id ?? null,
        provider_id: body.provider_id ?? null,
        referred_contact_id: body.referred_contact_id ?? null,
        operation_interest: normalizeInterest(body.operation_interest),
        property_legacy_code: body.property_legacy_code ?? null,
        message: body.message ?? null,
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
