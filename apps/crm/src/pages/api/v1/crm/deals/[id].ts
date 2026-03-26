import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import {
  hydrateDealRows,
  readBlockingDealLinks,
  readDealById,
  resolveDealPropertyForWrite,
  syncLeadStatusFromDealStage,
} from "@shared/deals/crud";
import { DEAL_STAGES, DEAL_SELECT_COLUMNS, normalizeDealStage } from "@shared/deals/domain";
import { resolveCrmOrgAccess } from "@shared/crm/access";
import { buildNotificationEntitySummary, readNotificationRows } from "@shared/notifications/sync";
import { asText, asUuid } from "@shared/portal/domain";
import { getSupabaseServerClient } from "@shared/supabase/server";

const buildPatchPayload = (body: Record<string, unknown>) => {
  const payload: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(body, "title")) payload.title = asText(body.title);
  if (Object.prototype.hasOwnProperty.call(body, "stage")) payload.stage = normalizeDealStage(body.stage);
  if (Object.prototype.hasOwnProperty.call(body, "expected_close_date")) payload.expected_close_date = asText(body.expected_close_date);
  if (Object.prototype.hasOwnProperty.call(body, "expected_value")) payload.expected_value = typeof body.expected_value === "number" ? body.expected_value : Number(body.expected_value ?? NaN);
  if (Object.prototype.hasOwnProperty.call(body, "currency")) payload.currency = asText(body.currency) ?? "EUR";
  if (Object.prototype.hasOwnProperty.call(body, "probability")) {
    const parsed = typeof body.probability === "number" ? body.probability : Number(body.probability ?? NaN);
    payload.probability = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 20;
  }
  if (Object.prototype.hasOwnProperty.call(body, "owner_id")) payload.owner_id = asUuid(body.owner_id as string | null);
  if (Object.prototype.hasOwnProperty.call(body, "property_id")) payload.property_id = asUuid(body.property_id as string | null);
  return payload;
};

export const GET: APIRoute = async ({ cookies, params, url }) => {
  const organizationIdHint = asText(url.searchParams.get("organization_id"));
  const dealId = asUuid(params.id);
  if (!dealId) return jsonResponse({ ok: false, error: "invalid_deal_id" }, { status: 400 });

  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint,
    allowedPermissions: ["crm.deals.read"],
  });
  if (access.error || !access.data) {
    return jsonResponse(
      { ok: false, error: access.error?.error ?? "crm_auth_required", details: access.error?.details },
      { status: access.error?.status ?? 401 }
    );
  }

  const organizationId = access.data.organization_id;
  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  try {
    const dealRow = await readDealById(client, organizationId, dealId);
    if (!dealRow) return jsonResponse({ ok: false, error: "deal_not_found" }, { status: 404 });
    const hydrated = await hydrateDealRows(client, organizationId, [dealRow]);
    const links = await readBlockingDealLinks(client, organizationId, dealId);
    const notificationRows = await readNotificationRows(client, organizationId, {
      includeClosed: true,
      dealId,
    }).catch(() => []);
    return jsonResponse({
      ok: true,
      data: hydrated[0]
        ? {
            ...hydrated[0],
            notifications_summary: buildNotificationEntitySummary(notificationRows),
          }
        : null,
      meta: {
        linked_contracts: links.contracts,
        linked_commissions: links.commissions,
      },
    });
  } catch (error) {
    return jsonResponse(
      { ok: false, error: "deal_read_failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
};

export const PATCH: APIRoute = async ({ cookies, params, request }) => {
  const body = (await parseJsonBody<Record<string, unknown>>(request)) ?? {};
  const organizationIdHint = asText(body.organization_id);
  const dealId = asUuid(params.id);
  if (!dealId) return jsonResponse({ ok: false, error: "invalid_deal_id" }, { status: 400 });

  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint,
    allowedPermissions: ["crm.deals.write"],
  });
  if (access.error || !access.data) {
    return jsonResponse(
      { ok: false, error: access.error?.error ?? "crm_auth_required", details: access.error?.details },
      { status: access.error?.status ?? 401 }
    );
  }

  const organizationId = access.data.organization_id;
  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  try {
    const current = await readDealById(client, organizationId, dealId);
    if (!current) return jsonResponse({ ok: false, error: "deal_not_found" }, { status: 404 });

    const patch = buildPatchPayload(body);
    if (Object.prototype.hasOwnProperty.call(body, "property_id")) {
      const requestedPropertyId = asUuid(body.property_id as string | null);
      if (requestedPropertyId) {
        const resolvedProperty = await resolveDealPropertyForWrite(client, organizationId, requestedPropertyId);
        patch.property_id = resolvedProperty.propertyId;
      } else {
        patch.property_id = null;
      }
    }

    if (!Object.keys(patch).length) {
      const hydrated = await hydrateDealRows(client, organizationId, [current]);
      return jsonResponse({ ok: true, data: hydrated[0] ?? null, meta: { updated: false } });
    }

    const { data, error } = await client
      .schema("crm")
      .from("deals")
      .update(patch)
      .eq("organization_id", organizationId)
      .eq("id", dealId)
      .select(DEAL_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      return jsonResponse({ ok: false, error: "db_deal_update_error", details: error?.message }, { status: 500 });
    }

    await syncLeadStatusFromDealStage(client, organizationId, asText((data as Record<string, unknown>).lead_id), patch.stage);

    const hydrated = await hydrateDealRows(client, organizationId, [data as Record<string, unknown>]);
    const notificationRows = await readNotificationRows(client, organizationId, {
      includeClosed: true,
      dealId,
    }).catch(() => []);
    return jsonResponse({
      ok: true,
      data: hydrated[0]
        ? {
            ...hydrated[0],
            notifications_summary: buildNotificationEntitySummary(notificationRows),
          }
        : null,
      meta: { updated: true },
    });
  } catch (error) {
    return jsonResponse(
      { ok: false, error: "deal_update_failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
};

export const DELETE: APIRoute = async ({ cookies, params, request }) => {
  const body = (await parseJsonBody<Record<string, unknown>>(request)) ?? {};
  const organizationIdHint = asText(body.organization_id);
  const dealId = asUuid(params.id);
  if (!dealId) return jsonResponse({ ok: false, error: "invalid_deal_id" }, { status: 400 });

  const access = await resolveCrmOrgAccess(cookies, {
    organizationIdHint,
    allowedPermissions: ["crm.deals.write"],
  });
  if (access.error || !access.data) {
    return jsonResponse(
      { ok: false, error: access.error?.error ?? "crm_auth_required", details: access.error?.details },
      { status: access.error?.status ?? 401 }
    );
  }

  const organizationId = access.data.organization_id;
  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  try {
    const current = await readDealById(client, organizationId, dealId);
    if (!current) return jsonResponse({ ok: false, error: "deal_not_found" }, { status: 404 });

    const links = await readBlockingDealLinks(client, organizationId, dealId);
    if (links.contracts > 0 || links.commissions > 0) {
      return jsonResponse(
        {
          ok: false,
          error: "deal_delete_blocked",
          details: `contracts=${links.contracts}; commissions=${links.commissions}`,
        },
        { status: 409 }
      );
    }

    const { error } = await client.schema("crm").from("deals").delete().eq("organization_id", organizationId).eq("id", dealId);
    if (error) {
      return jsonResponse({ ok: false, error: "db_deal_delete_error", details: error.message }, { status: 500 });
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse(
      { ok: false, error: "deal_delete_failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
};

export const POST: APIRoute = async () => methodNotAllowed(["GET", "PATCH", "DELETE"]);
export const PUT: APIRoute = async () => methodNotAllowed(["GET", "PATCH", "DELETE"]);
