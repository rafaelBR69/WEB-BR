# Flujo de datos

## Propiedades

1. Se leen JSON en `src/data/properties/*.json`
2. Carga automatica en `src/data/properties/index.ts` via `import.meta.glob`
3. Se normalizan segun contexto:
   - Tarjetas/listados: `normalizePropertyCard.ts`
   - Ficha detalle: `normalizeProperty.ts`
4. Se filtran/ordenan:
   - `buildFilters.ts`
   - `applyFilters.ts`
5. Se renderizan en:
   - `src/pages/[lang]/properties/index.astro`
   - `src/pages/[lang]/property/[slug].astro`
   - `src/pages/[lang]/projects/index.astro`
   - `src/pages/[lang]/index.astro` (preview + mapa)

## Mapa

1. `buildMapFeatures.ts` transforma propiedades en GeoJSON de puntos
2. `MapboxCostaMap.astro` renderiza y aplica:
   - filtros por zona/subzona
   - resultados visibles
   - rutas a POIs
3. Zonas y POIs vienen de:
   - `public/data/zones.geojson`
   - `public/data/pois.geojson`

## Posts

1. JSON en `src/data/posts/*.json`
2. Registro manual en `src/data/posts/index.ts`
3. Render en:
   - `src/pages/[lang]/posts/index.astro`
   - `src/pages/[lang]/post/[slug].astro`

## Equipo

1. JSON en `src/data/team/*.json`
2. Registro manual en `src/data/team/index.ts`
3. Render en `src/pages/[lang]/about/index.astro`

