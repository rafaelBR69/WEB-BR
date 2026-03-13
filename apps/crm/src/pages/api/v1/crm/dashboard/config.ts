import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { getSupabaseServerClient } from "@shared/supabase/server";

export const GET: APIRoute = async ({ url, request }) => {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return jsonResponse({ ok: false, error: "supabase_client_not_found" }, { status: 500 });
  }

  const organizationId = url.searchParams.get("organization_id");
  if (!organizationId) {
    return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 400 });
  }

  // In a real scenario, we'd get the user ID from the session. 
  // For now, we'll try to get it from the request headers or a mock if needed.
  // Assuming Middleware handles auth and injects user info or we use Supabase Auth.
  const { data: { user } } = await supabase.auth.getUser(request.headers.get("Authorization")?.split(" ")[1] ?? "");
  
  if (!user) {
    return jsonResponse({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_dashboards")
    .select("config")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, { status: 500 });
  }

  return jsonResponse({
    ok: true,
    data: data?.config ?? [],
  });
};

export const POST: APIRoute = async ({ request }) => {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return jsonResponse({ ok: false, error: "supabase_client_not_found" }, { status: 500 });
  }

  const body = await parseJsonBody<{ organization_id: string; config: any }>(request);
  if (!body || !body.organization_id || !body.config) {
    return jsonResponse({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const { data: { user } } = await supabase.auth.getUser(request.headers.get("Authorization")?.split(" ")[1] ?? "");
  if (!user) {
    return jsonResponse({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  const { error } = await supabase
    .from("user_dashboards")
    .upsert({
      organization_id: body.organization_id,
      user_id: user.id,
      config: body.config,
      updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id,user_id" });

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, { status: 500 });
  }

  return jsonResponse({ ok: true });
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
