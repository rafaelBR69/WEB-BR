# Playbook: anadir un post

## Paso 1: crear JSON

1. Copia `docs/templates/post.template.json`
2. Guarda en `src/data/posts/post-YYYY-tu-slug.json`
3. Completa:
   - `id`, `status`, `category`, `published_at`
   - `slugs.{lang}`
   - `translations.{lang}.title`
   - `translations.{lang}.excerpt`
   - `translations.{lang}.content[]`

## Paso 2: registrar en indice de posts

Editar `src/data/posts/index.ts`:

- importar el nuevo JSON
- anadirlo al array `posts`

Si no haces esto, no aparecera.

## Paso 3: validar

1. `npm run dev`
2. Revisar:
   - `/{lang}/posts/`
   - `/{lang}/post/{slug}/`
3. `npm run build`

## Notas

- Solo `status: "published"` aparece en listado y sitemap.
- Categoria valida:
  - `market`
  - `guide`
  - `company`

