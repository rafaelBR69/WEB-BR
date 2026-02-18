import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";

type CreateDocumentBody = {
  organization_id?: string;
  scope?: "lead" | "client" | "property" | "contract" | "invoice" | "general";
  title?: string;
  storage_bucket?: string;
  storage_path?: string;
  mime_type?: string;
};

const MOCK_DOCUMENTS = [
  {
    id: "dc_5001",
    title: "Reserva PM0084-B2.pdf",
    scope: "contract",
    storage_bucket: "crm-documents",
    storage_path: "contracts/CTR-2026-0009/reserva.pdf",
  },
];

export const GET: APIRoute = async () =>
  jsonResponse({
    ok: true,
    data: MOCK_DOCUMENTS,
    meta: {
      count: MOCK_DOCUMENTS.length,
      next_step: "connect_supabase_table_crm_documents",
    },
  });

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<CreateDocumentBody>(request);
  if (!body) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_json_body",
      },
      { status: 400 }
    );
  }

  const title = String(body.title ?? "").trim();
  const storagePath = String(body.storage_path ?? "").trim();
  if (!title || !storagePath) {
    return jsonResponse(
      {
        ok: false,
        error: "title_and_storage_path_required",
      },
      { status: 422 }
    );
  }

  return jsonResponse(
    {
      ok: true,
      data: {
        id: `dc_${crypto.randomUUID()}`,
        organization_id: body.organization_id ?? null,
        scope: body.scope ?? "general",
        title,
        storage_bucket: body.storage_bucket ?? "crm-documents",
        storage_path: storagePath,
        mime_type: body.mime_type ?? null,
        created_at: new Date().toISOString(),
      },
      meta: {
        persisted: false,
        next_step: "insert_into_crm_documents_in_supabase",
      },
    },
    { status: 201 }
  );
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
