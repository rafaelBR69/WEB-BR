import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed, parseJsonBody } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";
import { asBoolean, asNumber, asObject, asText, asUuid, normalizePortalAudience, toPositiveInt } from "@/utils/crmPortal";

type CreatePortalContentBody = {
  organization_id?: string;
  project_property_id?: string;
  language?: string;
  audience?: "agent" | "client" | "both";
  section_key?: string;
  title?: string | null;
  body_markdown?: string | null;
  media?: Record<string, unknown> | null;
  sort_order?: number | null;
  is_published?: boolean | null;
  created_by?: string | null;
  updated_by?: string | null;
};

type UpdatePortalContentBody = {
  organization_id?: string;
  id?: string;
  language?: string;
  audience?: "agent" | "client" | "both";
  section_key?: string;
  title?: string | null;
  body_markdown?: string | null;
  media?: Record<string, unknown> | null;
  sort_order?: number | null;
  is_published?: boolean | null;
  updated_by?: string | null;
};

const normalizeLanguage = (value: unknown) => {
  const language = asText(value)?.toLowerCase();
  if (!language) return null;
  return language.slice(0, 10);
};

const normalizeSectionKey = (value: unknown) => {
  const key = asText(value)?.toLowerCase();
  if (!key) return null;
  return key.slice(0, 80);
};

const normalizeSortOrder = (value: unknown) => {
  const parsed = asNumber(value);
  if (parsed == null) return 0;
  return Math.max(-9999, Math.min(9999, Math.floor(parsed)));
};

const mapPortalContentRow = (row: Record<string, unknown>) => ({
  id: asText(row.id),
  organization_id: asText(row.organization_id),
  project_property_id: asText(row.project_property_id),
  language: asText(row.language),
  audience: normalizePortalAudience(row.audience),
  section_key: asText(row.section_key),
  title: asText(row.title),
  body_markdown: asText(row.body_markdown),
  media: asObject(row.media),
  sort_order: asNumber(row.sort_order) ?? 0,
  is_published: asBoolean(row.is_published) ?? false,
  published_at: asText(row.published_at),
  created_by: asText(row.created_by),
  updated_by: asText(row.updated_by),
  created_at: asText(row.created_at),
  updated_at: asText(row.updated_at),
});

export const GET: APIRoute = async ({ url }) => {
  const organizationId = asText(url.searchParams.get("organization_id"));
  const id = asUuid(url.searchParams.get("id"));
  const projectId = asUuid(url.searchParams.get("project_property_id"));
  const language = normalizeLanguage(url.searchParams.get("language"));
  const audience = asText(url.searchParams.get("audience"));
  const sectionKey = normalizeSectionKey(url.searchParams.get("section_key"));
  const isPublished = asBoolean(url.searchParams.get("is_published"));
  const q = asText(url.searchParams.get("q"))?.toLowerCase() ?? "";
  const page = toPositiveInt(url.searchParams.get("page"), 1, 1, 10000);
  const perPage = toPositiveInt(url.searchParams.get("per_page"), 30, 1, 200);

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: [],
      meta: {
        count: 0,
        total: 0,
        page,
        per_page: perPage,
        total_pages: 1,
        persisted: false,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let query = client
    .schema("crm")
    .from("portal_content_blocks")
    .select("*", { count: "exact" })
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (id) query = query.eq("id", id);
  if (projectId) query = query.eq("project_property_id", projectId);
  if (language) query = query.eq("language", language);
  if (audience) query = query.eq("audience", audience);
  if (sectionKey) query = query.eq("section_key", sectionKey);
  if (isPublished != null) query = query.eq("is_published", isPublished);
  if (q) query = query.or(`title.ilike.%${q}%,section_key.ilike.%${q}%,body_markdown.ilike.%${q}%`);

  const { data, error, count } = await query;
  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_content_read_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  const rows = (data ?? []).map((row) => mapPortalContentRow(row as Record<string, unknown>));
  const total = typeof count === "number" ? count : rows.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return jsonResponse({
    ok: true,
    data: rows,
    meta: {
      count: rows.length,
      total,
      page,
      per_page: perPage,
      total_pages: totalPages,
      storage: "supabase.crm.portal_content_blocks",
    },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<CreatePortalContentBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationId = asText(body.organization_id);
  const projectId = asUuid(body.project_property_id);
  const language = normalizeLanguage(body.language);
  const audience = normalizePortalAudience(body.audience);
  const sectionKey = normalizeSectionKey(body.section_key);
  const title = asText(body.title);
  const bodyMarkdown = asText(body.body_markdown);
  const media = asObject(body.media);
  const sortOrder = normalizeSortOrder(body.sort_order);
  const isPublished = asBoolean(body.is_published) ?? false;
  const createdBy = asUuid(body.created_by);
  const updatedBy = asUuid(body.updated_by);

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (!projectId) return jsonResponse({ ok: false, error: "project_property_id_required" }, { status: 422 });
  if (!language) return jsonResponse({ ok: false, error: "language_required" }, { status: 422 });
  if (!sectionKey) return jsonResponse({ ok: false, error: "section_key_required" }, { status: 422 });

  if (!hasSupabaseServerClient()) {
    return jsonResponse(
      {
        ok: true,
        data: {
          id: `pcb_${crypto.randomUUID()}`,
          organization_id: organizationId,
          project_property_id: projectId,
          language,
          audience,
          section_key: sectionKey,
          title,
          body_markdown: bodyMarkdown,
          media,
          sort_order: sortOrder,
          is_published: isPublished,
        },
        meta: {
          persisted: false,
          storage: "mock_in_memory",
        },
      },
      { status: 201 }
    );
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const payload = {
    organization_id: organizationId,
    project_property_id: projectId,
    language,
    audience,
    section_key: sectionKey,
    title,
    body_markdown: bodyMarkdown,
    media,
    sort_order: sortOrder,
    is_published: isPublished,
    created_by: createdBy,
    updated_by: updatedBy,
  };

  const { data, error } = await client
    .schema("crm")
    .from("portal_content_blocks")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_content_insert_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  return jsonResponse(
    {
      ok: true,
      data: mapPortalContentRow(data as Record<string, unknown>),
      meta: {
        storage: "supabase.crm.portal_content_blocks",
      },
    },
    { status: 201 }
  );
};

export const PATCH: APIRoute = async ({ request }) => {
  const body = await parseJsonBody<UpdatePortalContentBody>(request);
  if (!body) return jsonResponse({ ok: false, error: "invalid_json_body" }, { status: 400 });

  const organizationId = asText(body.organization_id);
  const contentId = asUuid(body.id);

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (!contentId) return jsonResponse({ ok: false, error: "id_required" }, { status: 422 });

  const updatePayload: Record<string, unknown> = {};
  if (body.language != null) updatePayload.language = normalizeLanguage(body.language);
  if (body.audience != null) updatePayload.audience = normalizePortalAudience(body.audience);
  if (body.section_key != null) updatePayload.section_key = normalizeSectionKey(body.section_key);
  if (body.title != null) updatePayload.title = asText(body.title);
  if (body.body_markdown != null) updatePayload.body_markdown = asText(body.body_markdown);
  if (body.media != null) updatePayload.media = asObject(body.media);
  if (body.sort_order != null) updatePayload.sort_order = normalizeSortOrder(body.sort_order);
  if (body.is_published != null) updatePayload.is_published = asBoolean(body.is_published) ?? false;
  if (body.updated_by != null) updatePayload.updated_by = asUuid(body.updated_by);

  if (!Object.keys(updatePayload).length) {
    return jsonResponse({ ok: false, error: "no_fields_to_update" }, { status: 422 });
  }

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: {
        id: contentId,
        organization_id: organizationId,
        ...updatePayload,
      },
      meta: {
        persisted: false,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const { data, error } = await client
    .schema("crm")
    .from("portal_content_blocks")
    .update(updatePayload)
    .eq("organization_id", organizationId)
    .eq("id", contentId)
    .select("*")
    .single();

  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_content_update_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  return jsonResponse({
    ok: true,
    data: mapPortalContentRow(data as Record<string, unknown>),
    meta: {
      storage: "supabase.crm.portal_content_blocks",
    },
  });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const body = await parseJsonBody<{ organization_id?: string; id?: string }>(request);
  const organizationId = asText(body?.organization_id) ?? asText(url.searchParams.get("organization_id"));
  const contentId = asUuid(body?.id) ?? asUuid(url.searchParams.get("id"));

  if (!organizationId) return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  if (!contentId) return jsonResponse({ ok: false, error: "id_required" }, { status: 422 });

  if (!hasSupabaseServerClient()) {
    return jsonResponse({
      ok: true,
      data: {
        id: contentId,
        deleted: true,
      },
      meta: {
        persisted: false,
        storage: "mock_in_memory",
      },
    });
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  const { error } = await client
    .schema("crm")
    .from("portal_content_blocks")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", contentId);

  if (error) {
    return jsonResponse(
      {
        ok: false,
        error: "db_portal_content_delete_error",
        details: error.message,
      },
      { status: 500 }
    );
  }

  return jsonResponse({
    ok: true,
    data: {
      id: contentId,
      deleted: true,
    },
    meta: {
      storage: "supabase.crm.portal_content_blocks",
    },
  });
};

export const PUT: APIRoute = async () => methodNotAllowed(["GET", "POST", "PATCH", "DELETE"]);
