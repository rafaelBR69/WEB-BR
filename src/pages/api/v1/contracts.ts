import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";

type CreateContractBody = {
  organization_id?: string;
  contract_number?: string;
  client_id?: string;
  property_id?: string;
  type?: "sale" | "rent";
  total_amount?: number;
  currency?: string;
};

const MOCK_CONTRACTS = [
  {
    id: "ct_7001",
    contract_number: "CTR-2026-0009",
    client_id: "cl_3001",
    property_id: "pr_9002",
    type: "sale",
    status: "sent",
  },
  {
    id: "ct_7002",
    contract_number: "CTR-2026-0010",
    client_id: "cl_3002",
    property_id: "pr_9003",
    type: "rent",
    status: "signed",
  },
];

export const GET: APIRoute = async () =>
  jsonResponse({
    ok: true,
    data: MOCK_CONTRACTS,
    meta: {
      count: MOCK_CONTRACTS.length,
      next_step: "connect_supabase_table_crm_contracts",
    },
  });

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<CreateContractBody>(request);
  if (!body) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_json_body",
      },
      { status: 400 }
    );
  }

  const contractNumber = String(body.contract_number ?? "").trim();
  if (!contractNumber) {
    return jsonResponse(
      {
        ok: false,
        error: "contract_number_required",
      },
      { status: 422 }
    );
  }

  if (!body.client_id) {
    return jsonResponse(
      {
        ok: false,
        error: "client_id_required",
      },
      { status: 422 }
    );
  }

  return jsonResponse(
    {
      ok: true,
      data: {
        id: `ct_${crypto.randomUUID()}`,
        organization_id: body.organization_id ?? null,
        contract_number: contractNumber,
        client_id: body.client_id,
        property_id: body.property_id ?? null,
        type: body.type === "rent" ? "rent" : "sale",
        status: "draft",
        total_amount: typeof body.total_amount === "number" ? body.total_amount : null,
        currency: body.currency ?? "EUR",
        created_at: new Date().toISOString(),
      },
      meta: {
        persisted: false,
        next_step: "insert_into_crm_contracts_in_supabase",
      },
    },
    { status: 201 }
  );
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
