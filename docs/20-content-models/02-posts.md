# Modelo de posts

## Donde se guardan

- Archivos: `src/data/posts/*.json`
- Registro manual: `src/data/posts/index.ts`

## Campos base

- `id`
- `status` (`published` o borrador)
- `category` (`market`, `guide`, `company`)
- `featured` (boolean)
- `published_at` (`YYYY-MM-DD`)
- `reading_time_min` (numero)
- `slugs.{lang}`
- `translations.{lang}.title`

## Media y SEO

- Portada: `media.cover.url`
- Alt portada: `media.cover.alt.{lang}`
- SEO descripcion: `seo.meta_description.{lang}`

## Contenido rich text

Bloques soportados por `RichContent.astro`:

- `paragraph`
- `heading` con `level`
- `list` con `items`

## Importante

Aunque el archivo JSON exista, no aparece si no lo importas en:

- `src/data/posts/index.ts`

## Publicacion

- Solo se listan posts con `status: "published"`.
- Sitemap incluye posts publicados desde `src/pages/sitemap.xml.ts`.

