import type { APIRoute } from "astro";
import { jsonResponse } from "@/utils/crmApi";
import { getSupabaseServerClient } from "@/utils/supabaseServer";

export const GET: APIRoute = async ({ url }) => {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return jsonResponse({ ok: false, error: "supabase_client_not_found" }, { status: 500 });
  }

  const organizationId = url.searchParams.get("organization_id");
  const field = url.searchParams.get("field"); // e.g., 'status', 'origin_type', 'nationality'
  
  if (!organizationId || !field) {
    return jsonResponse({ ok: false, error: "missing_parameters" }, { status: 400 });
  }

  // Validate allowed fields to prevent SQL injection or bad queries
  const allowedFields = ["status", "origin_type", "lead_kind", "operation_interest", "nationality", "source"];
  if (!allowedFields.includes(field)) {
    return jsonResponse({ ok: false, error: "invalid_field" }, { status: 400 });
  }

  // Simple aggregation query using Supabase
  // For more complex ones, we might need a custom RPC or raw SQL via service role
  const { data, error } = await supabase
    .from("leads")
    .select(field)
    .eq("organization_id", organizationId);

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, { status: 500 });
  }

  // Aggregate counts in JS for simplicity, or use Postgres aggregation if preferred
  const stats = data.reduce((acc: Record<string, number>, item: any) => {
    const key = item[field] || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const formattedData = Object.entries(stats).map(([name, value]) => ({
    name,
    value,
  }));

  return jsonResponse({
    ok: true,
    data: formattedData,
  });
};
