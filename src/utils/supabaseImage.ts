const SUPABASE_PUBLIC_PATH = "/storage/v1/object/public/";
const SUPABASE_RENDER_PATH = "/storage/v1/render/image/public/";
const ENABLE_SUPABASE_TRANSFORMS =
  import.meta.env.PUBLIC_SUPABASE_IMAGE_TRANSFORMS !== "false";
const OPTIMIZED_MARKER = ["optimized", "v1"] as const;
const DEVICE_VARIANT_WIDTHS = {
  mobile: 420,
  tablet: 1020,
  desktop: 1800,
} as const;

type DeviceVariant = keyof typeof DEVICE_VARIANT_WIDTHS;

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

const parseSupabaseStorageObject = (url: string) => {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname ?? "";
    const prefix = pathname.includes(SUPABASE_PUBLIC_PATH)
      ? SUPABASE_PUBLIC_PATH
      : pathname.includes(SUPABASE_RENDER_PATH)
        ? SUPABASE_RENDER_PATH
        : null;
    if (!prefix) return null;

    const index = pathname.indexOf(prefix);
    const remaining = pathname.slice(index + prefix.length);
    const firstSlash = remaining.indexOf("/");
    if (firstSlash <= 0) return null;

    const bucket = remaining.slice(0, firstSlash).trim();
    const objectPath = remaining.slice(firstSlash + 1).trim();
    if (!bucket || !objectPath) return null;

    return {
      parsed,
      prefix,
      bucket,
      objectPath,
    };
  } catch {
    return null;
  }
};

const isDeviceVariant = (value: string): value is DeviceVariant =>
  value === "mobile" || value === "tablet" || value === "desktop";

const parseOptimizedVariantUrl = (url: string) => {
  const storage = parseSupabaseStorageObject(url);
  if (!storage) return null;

  const segments = storage.objectPath.split("/").filter((item) => item.length > 0);
  if (segments.length < 4) return null;

  const variantIndex = segments.length - 2;
  const currentVariant = segments[variantIndex];
  if (!isDeviceVariant(currentVariant)) return null;

  let markerIndex = -1;
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (segments[i] === OPTIMIZED_MARKER[0] && segments[i + 1] === OPTIMIZED_MARKER[1]) {
      markerIndex = i;
    }
  }
  if (markerIndex < 0) return null;
  if (variantIndex <= markerIndex + 1) return null;

  return {
    ...storage,
    segments,
    markerIndex,
    variantIndex,
    currentVariant,
  };
};

const buildOptimizedVariantUrl = (
  source: ReturnType<typeof parseOptimizedVariantUrl>,
  targetVariant: DeviceVariant
): string => {
  if (!source) return "";
  const nextSegments = [...source.segments];
  nextSegments[source.variantIndex] = targetVariant;
  const nextObjectPath = nextSegments.join("/");

  const parsed = new URL(source.parsed.toString());
  parsed.pathname = `${source.prefix}${source.bucket}/${nextObjectPath}`;
  parsed.search = "";
  return parsed.toString();
};

const pickVariantByWidth = (width: number | null): DeviceVariant => {
  if (!width) return "desktop";
  if (width <= DEVICE_VARIANT_WIDTHS.mobile) return "mobile";
  if (width <= DEVICE_VARIANT_WIDTHS.tablet) return "tablet";
  return "desktop";
};

const uniqueDeviceVariantsByRequestedWidths = (widths: number[]) => {
  const out = new Set<DeviceVariant>();
  const normalized = widths
    .map((value) => toPositiveInteger(value))
    .filter((value): value is number => value !== null);

  if (!normalized.length) {
    out.add("mobile");
    out.add("tablet");
    out.add("desktop");
    return Array.from(out);
  }

  normalized.forEach((width) => {
    out.add(pickVariantByWidth(width));
  });

  if (!out.has("desktop")) out.add("desktop");
  return Array.from(out).sort((a, b) => DEVICE_VARIANT_WIDTHS[a] - DEVICE_VARIANT_WIDTHS[b]);
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
  if (!isSupabaseStorageUrl(url)) return url;

  const optimized = parseOptimizedVariantUrl(url);
  if (optimized) {
    const width = toPositiveInteger(options.width);
    const targetVariant = pickVariantByWidth(width);
    const optimizedUrl = buildOptimizedVariantUrl(optimized, targetVariant);
    return optimizedUrl || url;
  }

  if (!ENABLE_SUPABASE_TRANSFORMS) return url;

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
  if (!isSupabaseStorageUrl(url)) return "";

  const optimized = parseOptimizedVariantUrl(url);
  if (optimized) {
    const variants = uniqueDeviceVariantsByRequestedWidths(widths);
    return variants
      .map((variant) => {
        const variantUrl = buildOptimizedVariantUrl(optimized, variant);
        const width = DEVICE_VARIANT_WIDTHS[variant];
        return `${variantUrl || url} ${width}w`;
      })
      .join(", ");
  }

  if (!ENABLE_SUPABASE_TRANSFORMS) return "";

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
