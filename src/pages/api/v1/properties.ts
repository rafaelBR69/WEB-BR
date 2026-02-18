import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";

type PropertyRecordType = "project" | "unit" | "single";
type OperationType = "sale" | "rent" | "both";

type CreatePropertyBody = {
  organization_id?: string;
  legacy_code?: string;
  record_type?: PropertyRecordType;
  operation_type?: OperationType;
  status?: string;
  parent_legacy_code?: string;
  price_sale?: number;
  price_rent_monthly?: number;
  currency?: string;
};

const MOCK_PROPERTIES = [
  {
    id: "pr_9001",
    legacy_code: "PM0084",
    record_type: "project",
    operation_type: "sale",
    status: "available",
    price_sale: 430000,
    price_rent_monthly: null,
  },
  {
    id: "pr_9002",
    legacy_code: "PM0084-B2",
    record_type: "unit",
    operation_type: "sale",
    status: "reserved",
    price_sale: 459000,
    price_rent_monthly: null,
  },
  {
    id: "pr_9003",
    legacy_code: "RENT-1043",
    record_type: "single",
    operation_type: "rent",
    status: "available",
    price_sale: null,
    price_rent_monthly: 1950,
  },
];

const normalizeRecordType = (value: unknown): PropertyRecordType => {
  if (value === "project" || value === "unit" || value === "single") return value;
  return "single";
};

const normalizeOperationType = (value: unknown): OperationType => {
  if (value === "sale" || value === "rent" || value === "both") return value;
  return "sale";
};

export const GET: APIRoute = async ({ url }) => {
  const operation = url.searchParams.get("operation");
  const recordType = url.searchParams.get("record_type");

  const data = MOCK_PROPERTIES.filter((item) => {
    if (operation && item.operation_type !== operation) return false;
    if (recordType && item.record_type !== recordType) return false;
    return true;
  });

  return jsonResponse({
    ok: true,
    data,
    meta: {
      count: data.length,
      supports: {
        operation_type: ["sale", "rent", "both"],
        record_type: ["project", "unit", "single"],
      },
      next_step: "replace_mock_with_supabase_query",
    },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<CreatePropertyBody>(request);
  if (!body) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_json_body",
      },
      { status: 400 }
    );
  }

  const legacyCode = String(body.legacy_code ?? "").trim();
  if (!legacyCode) {
    return jsonResponse(
      {
        ok: false,
        error: "legacy_code_required",
      },
      { status: 422 }
    );
  }

  const recordType = normalizeRecordType(body.record_type);
  const operationType = normalizeOperationType(body.operation_type);

  return jsonResponse(
    {
      ok: true,
      data: {
        id: `pr_${crypto.randomUUID()}`,
        organization_id: body.organization_id ?? null,
        legacy_code: legacyCode,
        record_type: recordType,
        operation_type: operationType,
        parent_legacy_code: body.parent_legacy_code ?? null,
        status: body.status ?? "draft",
        price_sale: typeof body.price_sale === "number" ? body.price_sale : null,
        price_rent_monthly:
          typeof body.price_rent_monthly === "number" ? body.price_rent_monthly : null,
        currency: body.currency ?? "EUR",
        created_at: new Date().toISOString(),
      },
      meta: {
        persisted: false,
        next_step: "insert_into_crm_properties_in_supabase",
      },
    },
    { status: 201 }
  );
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
