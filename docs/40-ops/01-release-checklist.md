# Checklist de publicacion

## Antes de merge

- JSON valido en todos los archivos nuevos
- Slugs completos por idioma en contenido nuevo
- Sin `status: "private"` accidental
- Sin links rotos de imagen/pdf
- Sin referencias a archivos borrados
- Si se toca anti-spam de formularios, revisar `PUBLIC_TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY`

## Pruebas manuales minimas

- Home: `/{lang}/`
- Proyectos: `/{lang}/projects/`
- Listado propiedades: `/{lang}/properties/`
- Ficha de proyecto nuevo: `/{lang}/property/{slug}/`
- Mapa: `/{lang}/map/`
- Posts: `/{lang}/posts/`
- Si se toca `POST /api/v1/leads`: probar `contact`, `sell-with-us` y `property`

## Build

- Ejecutar para web publica: `npm run build:production:web`
- Validar salida esperada en `dist/web`
- No publicar si build falla.

## SEO y rutas

- Revisar canonical.
- Revisar slugs por idioma.
- Revisar sitemap en `src/pages/sitemap.xml.ts` si se anadieron nuevos tipos de URL.
