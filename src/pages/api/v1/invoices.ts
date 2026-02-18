import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";

type CreateInvoiceBody = {
  organization_id?: string;
  invoice_number?: string;
  client_id?: string;
  contract_id?: string;
  subtotal?: number;
  tax_amount?: number;
  currency?: string;
  due_date?: string;
};

const MOCK_INVOICES = [
  {
    id: "iv_8801",
    invoice_number: "FAC-2026-0042",
    client_id: "cl_3002",
    status: "issued",
    total_amount: 14520,
    currency: "EUR",
  },
  {
    id: "iv_8802",
    invoice_number: "FAC-2026-0043",
    client_id: "cl_3001",
    status: "paid",
    total_amount: 9800,
    currency: "EUR",
  },
];

export const GET: APIRoute = async () =>
  jsonResponse({
    ok: true,
    data: MOCK_INVOICES,
    meta: {
      count: MOCK_INVOICES.length,
      next_step: "connect_supabase_table_crm_invoices",
    },
  });

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<CreateInvoiceBody>(request);
  if (!body) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_json_body",
      },
      { status: 400 }
    );
  }

  const invoiceNumber = String(body.invoice_number ?? "").trim();
  if (!invoiceNumber) {
    return jsonResponse(
      {
        ok: false,
        error: "invoice_number_required",
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

  const subtotal = typeof body.subtotal === "number" ? body.subtotal : 0;
  const taxAmount = typeof body.tax_amount === "number" ? body.tax_amount : 0;

  return jsonResponse(
    {
      ok: true,
      data: {
        id: `iv_${crypto.randomUUID()}`,
        organization_id: body.organization_id ?? null,
        invoice_number: invoiceNumber,
        client_id: body.client_id,
        contract_id: body.contract_id ?? null,
        subtotal,
        tax_amount: taxAmount,
        total_amount: subtotal + taxAmount,
        currency: body.currency ?? "EUR",
        due_date: body.due_date ?? null,
        status: "draft",
        created_at: new Date().toISOString(),
      },
      meta: {
        persisted: false,
        next_step: "insert_into_crm_invoices_in_supabase",
      },
    },
    { status: 201 }
  );
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
