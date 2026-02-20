import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";
import {
  deleteStorageObjectsByPublicUrls,
  ensurePropertyStorageScaffold,
} from "@/utils/crmPropertyStorage";
import { enqueueMediaOptimizeJob, triggerMediaOptimizeQueueWorker } from "@/utils/crmMediaOptimizeQueue";
import {
  type MediaCategory,
  MEDIA_CATEGORIES,
  mapPropertyRow,
  normalizeMediaModel,
} from "@/utils/crmProperties";
import { getMockPropertyRowById, patchMockPropertyRow } from "@/utils/crmMockPropertyStore";

type AddMediaBody = {
  organization_id?: string;
  category?: MediaCategory;
  url?: string;
  label?: string | null;
  alt_es?: string | null;
  set_as_cover?: boolean;
};

type PatchMediaBody = {
  organization_id?: string;
  action?: "set_cover" | "remove" | "move";
  category?: MediaCategory;
  item_id?: string;
  direction?: "up" | "down";
};

const SELECT_COLUMNS = [
  "id",
  "organization_id",
  "website_id",
  "legacy_code",
  "translations",
  "record_type",
  "project_business_type",
  "commercialization_notes",
  "parent_property_id",
  "operation_type",
  "status",
  "is_featured",
  "is_public",
  "price_sale",
  "price_rent_monthly",
  "price_currency",
  "property_data",
  "location",
  "media",
  "created_at",
  "updated_at",
].join(", ");

const toOptionalText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const toBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.toLowerCase().trim();
    if (lower === "true" || lower === "1" || lower === "yes") return true;
    if (lower === "false" || lower === "0" || lower === "no") return false;
  }
  return fallback;
};

const getPropertyIdFromParams = (params: Record<string, string | undefined>): string | null => {
  const raw = params.id;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
};

const isCategory = (value: unknown): value is MediaCategory =>
  typeof value === "string" && MEDIA_CATEGORIES.includes(value as MediaCategory);

const createMediaItem = (input: AddMediaBody) => {
  const url = toOptionalText(input.url);
  if (!url) return null;
  const altEs = toOptionalText(input.alt_es);
  return {
    id: crypto.randomUUID(),
    url,
    label: toOptionalText(input.label),
    alt: altEs ? { es: altEs } : {},
  };
};

const findItemById = (
  media: ReturnType<typeof normalizeMediaModel>,
  itemId: string,
  preferredCategory?: MediaCategory
) => {
  const categories = preferredCategory ? [preferredCategory] : MEDIA_CATEGORIES;
  for (const category of categories) {
    const index = media.gallery[category].findIndex((item) => item.id === itemId);
    if (index >= 0) {
      return {
        category,
        index,
        item: media.gallery[category][index],
      };
    }
  }
  return null;
};

const applyAddMedia = (
  media: ReturnType<typeof normalizeMediaModel>,
  body: AddMediaBody
): { ok: true } | { ok: false; error: string } => {
  if (!isCategory(body.category)) {
    return { ok: false, error: "invalid_or_missing_category" };
  }
  const item = createMediaItem(body);
  if (!item) return { ok: false, error: "url_required" };

  media.gallery[body.category] = [...media.gallery[body.category], item];
  if (toBoolean(body.set_as_cover, false) || !media.cover) {
    media.cover = item;
  }
  return { ok: true };
};

const applyPatchMedia = (
  media: ReturnType<typeof normalizeMediaModel>,
  body: PatchMediaBody
): { ok: true; removedUrls?: string[] } | { ok: false; error: string } => {
  const action = body.action;
  const itemId = toOptionalText(body.item_id);
  if (!action || !itemId) return { ok: false, error: "action_and_item_id_required" };

  if (action === "set_cover") {
    const match = findItemById(media, itemId, isCategory(body.category) ? body.category : undefined);
    if (!match) return { ok: false, error: "item_not_found" };
    media.cover = match.item;
    return { ok: true };
  }

  if (action === "remove") {
    const match = findItemById(media, itemId, isCategory(body.category) ? body.category : undefined);
    if (!match) return { ok: false, error: "item_not_found" };
    const removedUrl = toOptionalText(match.item?.url);
    media.gallery[match.category] = media.gallery[match.category].filter((entry) => entry.id !== itemId);
    if (media.cover?.id === itemId) {
      media.cover = null;
    }
    return { ok: true, removedUrls: removedUrl ? [removedUrl] : [] };
  }

  if (action === "move") {
    if (!isCategory(body.category)) return { ok: false, error: "category_required_for_move" };
    if (body.direction !== "up" && body.direction !== "down") {
      return { ok: false, error: "invalid_direction" };
    }
    const items = [...media.gallery[body.category]];
    const currentIndex = items.findIndex((entry) => entry.id === itemId);
    if (currentIndex < 0) return { ok: false, error: "item_not_found" };

    const targetIndex = body.direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return { ok: true };

    const tmp = items[currentIndex];
    items[currentIndex] = items[targetIndex];
    items[targetIndex] = tmp;
    media.gallery[body.category] = items;
    return { ok: true };
  }

  return { ok: false, error: "unsupported_action" };
};

export const GET: APIRoute = async ({ params, url }) => {
  const id = getPropertyIdFromParams(params);
  if (!id) return jsonResponse({ ok: false, error: "property_id_required" }, { status: 400 });

  const organizationId = toOptionalText(url.searchParams.get("organization_id"));

  if (!hasSupabaseServerClient()) {
    const row = getMockPropertyRowById(id);
    if (!row) return jsonResponse({ ok: false, error: "property_not_found" }, { status: 404 });
    if (organizationId && row.organization_id !== organizationId) {
      return jsonResponse({ ok: false, error: "property_not_found" }, { status: 404 });
    }
    return jsonResponse({
      ok: true,
      data: {
        property_id: id,
        media: normalizeMediaModel(row.media),
      },
      meta: { storage: "mock_in_memory" },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  let query = client.schema("crm").from("properties").select("id, organization_id, media").eq("id", id).maybeSingle();
  if (organizationId) query = query.eq("organization_id", organizationId);

  const { data, error } = await query;
  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_read_error",
        details: error.message,
      },
      { status: 500 }
    );
  }
  if (!data) return jsonResponse({ ok: false, error: "property_not_found" }, { status: 404 });

  return jsonResponse({
    ok: true,
    data: {
      property_id: id,
      media: normalizeMediaModel(data.media),
    },
    meta: { storage: "supabase.crm.properties" },
  });
};

export const POST: APIRoute = async ({ params, request }) => {
  const id = getPropertyIdFromParams(params);
  if (!id) return jsonResponse({ ok: false, error: "property_id_required" }, { status: 400 });

  const body = await parseJsonBody<AddMediaBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  if (!hasSupabaseServerClient()) {
    const current = getMockPropertyRowById(id);
    if (!current) return jsonResponse({ ok: false, error: "property_not_found" }, { status: 404 });

    const nextMedia = normalizeMediaModel(current.media);
    const applyResult = applyAddMedia(nextMedia, body);
    if (!applyResult.ok) return jsonResponse({ ok: false, error: applyResult.error }, { status: 422 });

    const next = patchMockPropertyRow(id, { media: nextMedia });
    if (!next) return jsonResponse({ ok: false, error: "property_not_found" }, { status: 404 });

    return jsonResponse({
      ok: true,
      data: mapPropertyRow(next),
      meta: { storage: "mock_in_memory", persisted: true },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  let currentQuery = client
    .schema("crm")
    .from("properties")
    .select("id, organization_id, media")
    .eq("id", id)
    .maybeSingle();

  const organizationId = toOptionalText(body.organization_id);
  if (organizationId) currentQuery = currentQuery.eq("organization_id", organizationId);

  const { data: current, error: currentError } = await currentQuery;
  if (currentError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_read_error",
        details: currentError.message,
      },
      { status: 500 }
    );
  }
  if (!current) return jsonResponse({ ok: false, error: "property_not_found" }, { status: 404 });

  const scopedOrganizationId = toOptionalText(current.organization_id);
  if (!scopedOrganizationId) {
    return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  }

  try {
    await ensurePropertyStorageScaffold(client, scopedOrganizationId, id);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "storage_scaffold_failed";
    return jsonResponse({ ok: false, error: "storage_scaffold_failed", details: detail }, { status: 500 });
  }

  const nextMedia = normalizeMediaModel(current.media);
  const applyResult = applyAddMedia(nextMedia, body);
  if (!applyResult.ok) return jsonResponse({ ok: false, error: applyResult.error }, { status: 422 });

  const { data, error } = await client
    .schema("crm")
    .from("properties")
    .update({ media: nextMedia })
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_update_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  const mappedData = data as Record<string, unknown>;
  const queueResult = await enqueueMediaOptimizeJob(client, {
    organizationId: scopedOrganizationId,
    propertyId: id,
    legacyCode: toOptionalText(mappedData.legacy_code),
    reason: "media_add",
    payload: { source: "api_media_post", category: body.category ?? null },
  });
  const kickResult = queueResult.enqueued
    ? triggerMediaOptimizeQueueWorker({ maxJobs: 1 })
    : { kicked: false, reason: "not_enqueued" };

  return jsonResponse({
    ok: true,
    data: mapPropertyRow(mappedData),
    meta: {
      storage: "supabase.crm.properties",
      persisted: true,
      media_optimize_queue: {
        ...queueResult,
        worker_kicked: kickResult.kicked,
        worker_kick_reason: kickResult.reason,
      },
    },
  });
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = getPropertyIdFromParams(params);
  if (!id) return jsonResponse({ ok: false, error: "property_id_required" }, { status: 400 });

  const body = await parseJsonBody<PatchMediaBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  if (!hasSupabaseServerClient()) {
    const current = getMockPropertyRowById(id);
    if (!current) return jsonResponse({ ok: false, error: "property_not_found" }, { status: 404 });

    const nextMedia = normalizeMediaModel(current.media);
    const applyResult = applyPatchMedia(nextMedia, body);
    if (!applyResult.ok) return jsonResponse({ ok: false, error: applyResult.error }, { status: 422 });

    const next = patchMockPropertyRow(id, { media: nextMedia });
    if (!next) return jsonResponse({ ok: false, error: "property_not_found" }, { status: 404 });

    return jsonResponse({
      ok: true,
      data: mapPropertyRow(next),
      meta: { storage: "mock_in_memory", persisted: true },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  let currentQuery = client
    .schema("crm")
    .from("properties")
    .select("id, organization_id, media")
    .eq("id", id)
    .maybeSingle();

  const organizationId = toOptionalText(body.organization_id);
  if (organizationId) currentQuery = currentQuery.eq("organization_id", organizationId);

  const { data: current, error: currentError } = await currentQuery;
  if (currentError) {
    return jsonResponse(
      {
        ok: false,
        error: "db_read_error",
        details: currentError.message,
      },
      { status: 500 }
    );
  }
  if (!current) return jsonResponse({ ok: false, error: "property_not_found" }, { status: 404 });

  const nextMedia = normalizeMediaModel(current.media);
  const applyResult = applyPatchMedia(nextMedia, body);
  if (!applyResult.ok) return jsonResponse({ ok: false, error: applyResult.error }, { status: 422 });

  const { data, error } = await client
    .schema("crm")
    .from("properties")
    .update({ media: nextMedia })
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_update_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  let cleanupMeta: Record<string, unknown> | undefined;
  if (applyResult.removedUrls?.length) {
    const cleanup = await deleteStorageObjectsByPublicUrls(client, applyResult.removedUrls);
    cleanupMeta = cleanup.errors.length
      ? {
          cleanup_removed: cleanup.removed,
          cleanup_failed: cleanup.failed,
          cleanup_errors: cleanup.errors,
        }
      : {
          cleanup_removed: cleanup.removed,
          cleanup_failed: cleanup.failed,
        };
  }

  return jsonResponse({
    ok: true,
    data: mapPropertyRow(data as Record<string, unknown>),
    meta: { storage: "supabase.crm.properties", persisted: true, ...(cleanupMeta ?? {}) },
  });
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "POST", "PATCH"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["GET", "POST", "PATCH"]);
