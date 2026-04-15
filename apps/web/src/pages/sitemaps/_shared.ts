import posts from "@shared/data/posts";
import teamMembers from "@shared/data/team";
import { SUPPORTED_LANGS } from "@shared/i18n/languages";
import {
  getPublicPropertiesWithFallback,
  normalizeProperty,
  normalizeVisiblePublicPropertyCards,
} from "@shared/properties/public";
import { evaluatePropertyLandingEligibility } from "@shared/seo/propertyLandingEligibility";

const SITE_URL = "https://blancareal.com";

type PublicProperty = Record<string, unknown>;

export type SitemapEntry = {
  path: string;
  lastmod?: string | null;
};

export const SITEMAP_CHILD_PATHS = [
  "/sitemaps/core.xml",
  "/sitemaps/posts.xml",
  "/sitemaps/agents.xml",
  "/sitemaps/properties.xml",
  "/sitemaps/property-landings.xml",
] as const;

const CORE_PATHS = SUPPORTED_LANGS.flatMap((lang) => [
  `/${lang}/`,
  `/${lang}/properties/`,
  `/${lang}/legal-services/`,
  `/${lang}/commercialization/`,
  `/${lang}/sell-with-us/`,
  `/${lang}/agents/`,
  `/${lang}/contact/`,
  `/${lang}/projects/`,
  `/${lang}/legal/notice/`,
  `/${lang}/legal/privacy/`,
  `/${lang}/legal/cookies/`,
]);

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const slugify = (value: string) =>
  String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

const xmlEscape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const toAbsoluteUrl = (path: string) => new URL(path, SITE_URL).toString();

const toIsoLastmod = (value: unknown) => {
  const text = asText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const dedupeEntries = (entries: SitemapEntry[]) => {
  const next = new Map<string, SitemapEntry>();

  entries.forEach((entry) => {
    const previous = next.get(entry.path);
    const previousTime = previous?.lastmod ? new Date(previous.lastmod).getTime() : 0;
    const currentTime = entry.lastmod ? new Date(entry.lastmod).getTime() : 0;

    if (!previous || currentTime >= previousTime) {
      next.set(entry.path, entry);
    }
  });

  return Array.from(next.values()).sort((left, right) => left.path.localeCompare(right.path));
};

const createXmlResponse = (body: string) =>
  new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=900",
    },
  });

let publicPropertiesPromise: Promise<PublicProperty[]> | null = null;

const getPublicProperties = async () => {
  if (!publicPropertiesPromise) {
    publicPropertiesPromise = getPublicPropertiesWithFallback({}).then((result) => result.properties);
  }

  return publicPropertiesPromise;
};

export const buildSitemapIndexResponse = (paths: readonly string[]) => {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths
  .map(
    (path) => `  <sitemap>
    <loc>${xmlEscape(toAbsoluteUrl(path))}</loc>
  </sitemap>`
  )
  .join("\n")}
</sitemapindex>`;

  return createXmlResponse(body);
};

export const buildUrlSetResponse = (entries: SitemapEntry[]) => {
  const deduped = dedupeEntries(entries);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${deduped
  .map((entry) => {
    const lastmod = entry.lastmod ? `\n    <lastmod>${xmlEscape(entry.lastmod)}</lastmod>` : "";
    return `  <url>
    <loc>${xmlEscape(toAbsoluteUrl(entry.path))}</loc>${lastmod}
  </url>`;
  })
  .join("\n")}
</urlset>`;

  return createXmlResponse(body);
};

export const getCoreSitemapEntries = () => CORE_PATHS.map((path) => ({ path }));

export const getPostSitemapEntries = () => {
  const publishedPosts = posts.filter((post) => post.status === "published");
  const postsUpdatedAt = publishedPosts
    .map((post) => toIsoLastmod(post.updated_at ?? post.published_at))
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  const entries = SUPPORTED_LANGS.flatMap((lang) => {
    const indexEntry: SitemapEntry = {
      path: `/${lang}/posts/`,
      lastmod: postsUpdatedAt ?? null,
    };

    const detailEntries = publishedPosts
      .map((post) => {
        const slug = post.slugs?.[lang] ?? post.slugs?.es ?? null;
        if (!slug) return null;

        return {
          path: `/${lang}/post/${slug}/`,
          lastmod: toIsoLastmod(post.updated_at ?? post.published_at),
        } satisfies SitemapEntry;
      })
      .filter((entry): entry is SitemapEntry => Boolean(entry));

    return [indexEntry, ...detailEntries];
  });

  return dedupeEntries(entries);
};

export const getAgentSitemapEntries = () =>
  dedupeEntries(
    SUPPORTED_LANGS.flatMap((lang) =>
      teamMembers.map((member) => {
        const slug = member.id ?? slugify(member.name ?? "");
        return {
          path: `/${lang}/agents/${slug}/`,
        } satisfies SitemapEntry;
      })
    )
  );

export const getPropertySitemapEntries = async () => {
  const properties = await getPublicProperties();

  const entries = SUPPORTED_LANGS.flatMap((lang) =>
    properties
      .map((property) => ({
        property,
        data: normalizeProperty(property, lang),
        slug: asText(asRecord(property.slugs)[lang]),
      }))
      .filter(
        ({ data, slug }) =>
          Boolean(slug) &&
          Boolean(data) &&
          data.visible &&
          !data.seo.noindex
      )
      .map(({ property, slug }) => ({
        path: `/${lang}/property/${slug}/`,
        lastmod: toIsoLastmod(property.updated_at),
      }))
  );

  return dedupeEntries(entries);
};

export const getPropertyLandingSitemapEntries = async () => {
  const properties = await getPublicProperties();

  const entries = SUPPORTED_LANGS.flatMap((lang) => {
    const cards = normalizeVisiblePublicPropertyCards(properties, lang);

    return evaluatePropertyLandingEligibility({ lang, cards })
      .filter((entry) => entry.showInSitemap)
      .map((entry) => ({
        path: entry.landing.canonicalPath,
      }));
  });

  return dedupeEntries(entries);
};
