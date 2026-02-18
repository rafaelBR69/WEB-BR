import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";

type CreateClientBody = {
  organization_id?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  client_type?: "individual" | "company";
};

const MOCK_CLIENTS = [
  {
    id: "cl_3001",
    full_name: "Arancha Molina",
    email: "arancha@example.com",
    client_type: "individual",
    client_status: "active",
  },
  {
    id: "cl_3002",
    full_name: "North Sea Capital BV",
    email: "ops@northsea-capital.com",
    client_type: "company",
    client_status: "active",
  },
];

export const GET: APIRoute = async () =>
  jsonResponse({
    ok: true,
    data: MOCK_CLIENTS,
    meta: {
      count: MOCK_CLIENTS.length,
      next_step: "connect_supabase_table_crm_clients",
    },
  });

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<CreateClientBody>(request);
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
  if (!fullName) {
    return jsonResponse(
      {
        ok: false,
        error: "full_name_required",
      },
      { status: 422 }
    );
  }

  const type = body.client_type === "company" ? "company" : "individual";

  return jsonResponse(
    {
      ok: true,
      data: {
        id: `cl_${crypto.randomUUID()}`,
        organization_id: body.organization_id ?? null,
        full_name: fullName,
        email: body.email ?? null,
        phone: body.phone ?? null,
        client_type: type,
        client_status: "active",
        created_at: new Date().toISOString(),
      },
      meta: {
        persisted: false,
        next_step: "insert_into_crm_clients_in_supabase",
      },
    },
    { status: 201 }
  );
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
