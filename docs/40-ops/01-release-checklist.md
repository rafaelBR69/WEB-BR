# Checklist de publicacion

## Antes de merge

- JSON valido en todos los archivos nuevos
- Slugs completos por idioma en contenido nuevo
- Sin `status: "private"` accidental
- Sin links rotos de imagen/pdf
- Sin referencias a archivos borrados

## Pruebas manuales minimas

- Home: `/{lang}/`
- Proyectos: `/{lang}/projects/`
- Listado propiedades: `/{lang}/properties/`
- Ficha de proyecto nuevo: `/{lang}/property/{slug}/`
- Mapa: `/{lang}/map/`
- Posts: `/{lang}/posts/`

## Build

- Ejecutar: `npm run build`
- No publicar si build falla.

## SEO y rutas

- Revisar canonical.
- Revisar slugs por idioma.
- Revisar sitemap en `src/pages/sitemap.xml.ts` si se anadieron nuevos tipos de URL.

