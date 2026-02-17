const SUPABASE_PUBLIC_PATH = "/storage/v1/object/public/";
const SUPABASE_RENDER_PATH = "/storage/v1/render/image/public/";
const ENABLE_SUPABASE_TRANSFORMS =
  import.meta.env.PUBLIC_SUPABASE_IMAGE_TRANSFORMS !== "false";

type TransformOptions = {
  width?: number;
  height?: number;
  quality?: number;
  resize?: "cover" | "contain" | "fill";
  format?: "origin";
};

const toPositiveInteger = (value: unknown): number | null => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  return Math.round(n);
};

export const isSupabaseStorageUrl = (url: string): boolean => {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname ?? "";
    return pathname.includes(SUPABASE_PUBLIC_PATH) || pathname.includes(SUPABASE_RENDER_PATH);
  } catch {
    return false;
  }
};

export const buildSupabaseImageUrl = (url: string, options: TransformOptions = {}): string => {
  if (!ENABLE_SUPABASE_TRANSFORMS) return url;
  if (!isSupabaseStorageUrl(url)) return url;

  try {
    const parsed = new URL(url);
    if (parsed.pathname.includes(SUPABASE_PUBLIC_PATH)) {
      parsed.pathname = parsed.pathname.replace(SUPABASE_PUBLIC_PATH, SUPABASE_RENDER_PATH);
    }

    const searchParams = parsed.searchParams;
    const width = toPositiveInteger(options.width);
    const height = toPositiveInteger(options.height);
    const quality = toPositiveInteger(options.quality);

    if (width) searchParams.set("width", String(width));
    if (height) searchParams.set("height", String(height));
    if (quality) searchParams.set("quality", String(quality));
    if (options.resize) searchParams.set("resize", options.resize);
    if (options.format) searchParams.set("format", options.format);

    return parsed.toString();
  } catch {
    return url;
  }
};

export const buildSupabaseSrcSet = (
  url: string,
  widths: number[],
  options: Omit<TransformOptions, "width"> = {}
): string => {
  if (!ENABLE_SUPABASE_TRANSFORMS) return "";
  if (!isSupabaseStorageUrl(url)) return "";

  const widthList = Array.from(
    new Set(widths.map((value) => toPositiveInteger(value)).filter((value): value is number => value !== null))
  ).sort((a, b) => a - b);

  if (!widthList.length) return "";

  return widthList
    .map((width) => {
      const transformed = buildSupabaseImageUrl(url, { ...options, width });
      return `${transformed} ${width}w`;
    })
    .join(", ");
};
