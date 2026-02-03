# BUSCADOR.md

## Objetivo
Crear un buscador de propiedades usable hoy y escalable a futuro, con soporte multidioma y mantenimiento minimo.

## Lo que ya esta implementado (fase 1)
- Busqueda por texto en el listado de propiedades (pagina `src/pages/es/properties/index.astro`).
- El termino de busqueda se pasa por query param `q` y se conserva al usar filtros y ordenacion.
- El buscador funciona con un indice generado en build a partir de los JSON de propiedades.
- La busqueda es multidioma: se indexan todas las traducciones disponibles por propiedad.

## Como funciona
1) Cada propiedad se normaliza en `src/utils/normalizePropertyCard.ts`.
2) Se construye un texto de busqueda (todas las traducciones + ubicacion + tipo + estado + slugs) con:
   - `src/utils/search.ts` -> `buildSearchText` y `normalizeSearchText`.
3) `src/utils/applyFilters.ts` filtra por texto usando el parametro `q`.
4) En el listado se muestra el input de busqueda y el texto activo.

## Mantenimiento basico
- No hay que tocar el buscador si solo se agregan nuevas propiedades en JSON.
- Si se agregan nuevos campos importantes (ej. cercania a playa, amenities), se pueden incluir en `buildSearchText`.

## Siguientes pasos recomendados (para un buscador perfecto)
1) Crear rutas multi-idioma del listado (`src/pages/[lang]/properties/index.astro`) y reutilizar el buscador.
2) Mejorar relevancia con ranking y tolerancia a errores (ej. Fuse.js o un scoring propio).
3) Agregar sinonimos por idioma (ej. "atico" -> "penthouse", "pisos" -> "apartments").
4) Indexar campos numericos para busquedas tipo "3 dormitorios" o "< 500k".
5) Si el catalogo crece mucho, pasar a busqueda server-side o servicio externo (Algolia, Typesense, Meilisearch).

## Archivos clave
- `src/pages/es/properties/index.astro`
- `src/utils/normalizePropertyCard.ts`
- `src/utils/applyFilters.ts`
- `src/utils/search.ts`
- `src/styles/pages/properties.css`
