import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@shared/api/json";
import { hydrateDealRows, createOrReuseDeal } from "@shared/deals/crud";
import { DEAL_SELECT_COLUMNS, DEAL_STAGES, normalizeDealStage } from "@shared/deals/domain";
import { resolveCrmOrgAccess } from "@shared/crm/access";
import { asText, asUuid, toPositiveInt } from "@shared/portal/domain";
import { getSupabaseServerClient } from "@shared/supabase/server";

type QueryChunkResult = {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
};

const readAllPages = async (
  loader: (from: number, to: number) => Promise<QueryChunkResult>,
  pageSize = 500
): Promise<Record<string, unknown>[]> => {
  const rows: Record<string, unknown>[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await loader(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const chunk = Array.isArray(data) ? data : [];
    if (!chunk.length) break;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += chunk.length;
  }

  return rows;
};

const filterByProject = async (
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  organizationId: string,
  projectId: string
) => {
  const { data, error } = await client
    .schema("crm")
    .from("properties")
    .select("id")
    .eq("organization_id", organizationId)
    .or(`id.eq.${projectId},parent_property_id.eq.${projectId}`);

  if (error) throw new Error(`db_project_properties_read_error:${error.message}`);
  return Array.from(
    new Set(
      (data ?? [])
        .map((row) => asUuid((row as Record<string, unknown>).id))
        .filter((value): value is string => Boolean(value))
    )
  );
};

const applyBaseFilters = (
  query: any,
  input: {
    organizationId: string;
    stage: string | null;
    leadId: string | null;
    clientId: string | null;
    propertyId: string | null;
    onlyOpen: boolean;
  }
) => {
  let next = query.eq("organization_id", input.organizationId);
  if (input.stage) next = next.eq("stage", input.stage);
  if (input.leadId) next = next.eq("lead_id", input.leadId);
  if (input.clientId) next = next.eq("client_id", input.clientId);
  if (input.propertyId) next = next.eq("property_id", input.propertyId);
  if (input.onlyOpen) next = next.not("stage", "in", "(won,lost)");
  return next;
};

export const GET: APIRoute = async ({ cookies, url }) => {
  const organizationIdHint = asText(url.searchParams.get("organization_id"));
  const q = asText(url.searchParams.get("q"))?.toLowerCase() ?? "";
  const stageRaw = asText(url.searchParams.get("stage"));
  const stage = stageRaw && DEAL_STAGES.includes(stageRaw as (typeof DEAL_STAGES)[number]) ? stageRaw : null;
  const leadId = asUuid(url.searchParams.get("lead_id"));
  const clientId = asUuid(url.searchParams.get("client_id"));
  const propertyId = asUuid(url.searchParams.get("property_id"));
  const projectId = asUuid(url.searchParams.get("project_id"));
  const onlyOpen = ["1", "true", "yes", "si"].includes(String(url.searchParams.get("only_open") ?? "").trim().toLowerCase());
  const page = toPositiveInt(url.searchParams.get("page"), 1, 1, 10000);
  const perPage = toPositiveInt(url.searchParams.get("per_page"), 25, 1, 200);

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
    const needsInMemoryFiltering = Boolean(q || projectId);
    let rows: Array<Record<string, unknown>> = [];
    let total = 0;

    if (needsInMemoryFiltering) {
      rows = await readAllPages(async (from, to) => {
        const response = (await applyBaseFilters(
          client.schema("crm").from("deals").select(DEAL_SELECT_COLUMNS).order("updated_at", { ascending: false }).range(from, to),
          { organizationId, stage, leadId, clientId, propertyId, onlyOpen }
        )) as unknown as QueryChunkResult;
        return response;
      });

      if (projectId) {
        const allowedPropertyIds = await filterByProject(client, organizationId, projectId);
        const allowedSet = new Set(allowedPropertyIds);
        rows = rows.filter((row) => {
          const rowPropertyId = asUuid(row.property_id);
          return Boolean(rowPropertyId && allowedSet.has(rowPropertyId));
        });
      }

      const hydrated = await hydrateDealRows(client, organizationId, rows);
      const filtered = q
        ? hydrated.filter((row) =>
            [
              row.title,
              row.stage,
              row.client?.full_name,
              row.client?.client_code,
              row.lead?.full_name,
              row.property?.display_name,
              row.property?.legacy_code,
              row.property?.project_label,
            ]
              .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
              .some((value) => value.toLowerCase().includes(q))
          )
        : hydrated;

      total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / perPage));
      const safePage = Math.min(page, totalPages);
      const start = (safePage - 1) * perPage;
      const data = filtered.slice(start, start + perPage);
      return jsonResponse({
        ok: true,
        data,
        meta: {
          total,
          page: safePage,
          per_page: perPage,
          total_pages: totalPages,
        },
      });
    }

    const from = (page - 1) * perPage;
    const to = from + perPage - 1;
    const { data, error, count } = await applyBaseFilters(
      client.schema("crm").from("deals").select(DEAL_SELECT_COLUMNS, { count: "exact" }).order("updated_at", { ascending: false }).range(from, to),
      { organizationId, stage, leadId, clientId, propertyId, onlyOpen }
    );

    if (error) {
      return jsonResponse({ ok: false, error: "db_deals_read_error", details: error.message }, { status: 500 });
    }

    rows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    total = Number(count ?? rows.length);
    const hydrated = await hydrateDealRows(client, organizationId, rows);
    const totalPages = Math.max(1, Math.ceil(total / perPage));

    return jsonResponse({
      ok: true,
      data: hydrated,
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: totalPages,
      },
    });
  } catch (error) {
    return jsonResponse(
      { ok: false, error: "deal_list_failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const body = (await parseJsonBody<Record<string, unknown>>(request)) ?? {};
  const organizationIdHint = asText(body.organization_id);

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
    const result = await createOrReuseDeal(client, {
      organizationId,
      leadId: asText(body.lead_id),
      clientId: asText(body.client_id),
      propertyId: asText(body.property_id),
      title: asText(body.title),
      stage: asText(body.stage),
      expectedCloseDate: asText(body.expected_close_date),
      expectedValue: typeof body.expected_value === "number" ? body.expected_value : Number(body.expected_value ?? NaN),
      currency: asText(body.currency),
      probability: typeof body.probability === "number" ? body.probability : Number(body.probability ?? NaN),
      ownerId: asText(body.owner_id),
    });

    const hydrated = await hydrateDealRows(client, organizationId, [result.row]);
    return jsonResponse(
      {
        ok: true,
        data: hydrated[0] ?? null,
        meta: {
          created: result.created,
        },
      },
      { status: result.created ? 201 : 200 }
    );
  } catch (error) {
    return jsonResponse(
      { ok: false, error: "deal_create_failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
};

export const PATCH: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "POST"]);
