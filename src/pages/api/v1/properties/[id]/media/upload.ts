import type { APIRoute } from "astro";
import { jsonResponse, methodNotAllowed } from "@/utils/crmApi";
import { getSupabaseServerClient, hasSupabaseServerClient } from "@/utils/supabaseServer";
import { mapPropertyRow, MEDIA_CATEGORIES, normalizeMediaModel, type MediaCategory } from "@/utils/crmProperties";
import { uploadPropertyMediaFile } from "@/utils/crmPropertyStorage";

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

const getPropertyIdFromParams = (params: Record<string, string | undefined>): string | null => {
  const raw = params.id;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
};

const toOptionalText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const toBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.toLowerCase().trim();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  return fallback;
};

const isCategory = (value: unknown): value is MediaCategory =>
  typeof value === "string" && MEDIA_CATEGORIES.includes(value as MediaCategory);

const buildMediaItem = (payload: { url: string; label: string | null; altEs: string | null }) => ({
  id: crypto.randomUUID(),
  url: payload.url,
  label: payload.label,
  alt: payload.altEs ? { es: payload.altEs } : {},
});

export const POST: APIRoute = async ({ params, request }) => {
  const id = getPropertyIdFromParams(params);
  if (!id) return jsonResponse({ ok: false, error: "property_id_required" }, { status: 400 });

  if (!hasSupabaseServerClient()) {
    return jsonResponse(
      { ok: false, error: "upload_requires_supabase", details: "SUPABASE_URL y SERVICE_ROLE son obligatorios." },
      { status: 501 }
    );
  }

  const formData = await request.formData();
  const organizationId = toOptionalText(formData.get("organization_id"));
  const category = toOptionalText(formData.get("category"));
  const label = toOptionalText(formData.get("label"));
  const altEs = toOptionalText(formData.get("alt_es"));
  const setAsCover = toBoolean(formData.get("set_as_cover"), false);
  const fileValue = formData.get("file");

  if (!isCategory(category)) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_or_missing_category",
        details: `Categoria no valida. Usa una de: ${MEDIA_CATEGORIES.join(", ")}`,
      },
      { status: 422 }
    );
  }
  if (!(fileValue instanceof File)) {
    return jsonResponse(
      {
        ok: false,
        error: "file_required",
        details: "Debes adjuntar un archivo.",
      },
      { status: 422 }
    );
  }

  const client = getSupabaseServerClient();
  if (!client) return jsonResponse({ ok: false, error: "supabase_not_configured" }, { status: 500 });

  let currentQuery = client
    .schema("crm")
    .from("properties")
    .select("id, organization_id, media")
    .eq("id", id)
    .maybeSingle();

  if (organizationId) currentQuery = currentQuery.eq("organization_id", organizationId);

  const { data: current, error: currentError } = await currentQuery;
  if (currentError) {
    return jsonResponse(
      { ok: false, error: "db_read_error", details: currentError.message },
      { status: 500 }
    );
  }
  if (!current) return jsonResponse({ ok: false, error: "property_not_found" }, { status: 404 });

  const scopedOrganizationId = toOptionalText(current.organization_id);
  if (!scopedOrganizationId) {
    return jsonResponse({ ok: false, error: "organization_id_required" }, { status: 422 });
  }

  let uploaded: { bucket: string; path: string; publicUrl: string; mimeType: string; bytes: number };
  try {
    uploaded = await uploadPropertyMediaFile(client, {
      organizationId: scopedOrganizationId,
      propertyId: id,
      category,
      file: fileValue,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "storage_upload_failed";
    const status =
      detail.includes("unsupported_file_type") ||
      detail.includes("file_too_large") ||
      detail.includes("empty_file")
        ? 422
        : 500;
    let readableDetail = detail;
    if (detail.includes("unsupported_file_type")) {
      readableDetail = "Formato no permitido. Usa PNG, JPG/JPEG o WEBP.";
    } else if (detail.includes("file_too_large")) {
      readableDetail = "Archivo demasiado grande. Maximo 10 MB.";
    } else if (detail.includes("empty_file")) {
      readableDetail = "El archivo esta vacio.";
    }
    return jsonResponse(
      {
        ok: false,
        error: "storage_upload_failed",
        details: readableDetail,
      },
      { status }
    );
  }

  const nextMedia = normalizeMediaModel(current.media);
  const item = buildMediaItem({ url: uploaded.publicUrl, label, altEs });
  nextMedia.gallery[category] = [...nextMedia.gallery[category], item];
  if (setAsCover || !nextMedia.cover) nextMedia.cover = item;

  const { data, error } = await client
    .schema("crm")
    .from("properties")
    .update({ media: nextMedia })
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    return jsonResponse(
      { ok: false, error: "db_update_error", details: error.message },
      { status: 500 }
    );
  }

  return jsonResponse({
    ok: true,
    data: mapPropertyRow(data as Record<string, unknown>),
    meta: {
      persisted: true,
      storage: "supabase.crm.properties",
      storage_bucket: uploaded.bucket,
      storage_path: uploaded.path,
      storage_url: uploaded.publicUrl,
      file_size: uploaded.bytes,
      mime_type: uploaded.mimeType,
    },
  });
};

export const GET: APIRoute = async () => methodNotAllowed(["POST"]);
export const PUT: APIRoute = async () => methodNotAllowed(["POST"]);
export const PATCH: APIRoute = async () => methodNotAllowed(["POST"]);
export const DELETE: APIRoute = async () => methodNotAllowed(["POST"]);
