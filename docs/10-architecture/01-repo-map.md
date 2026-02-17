# Mapa del repositorio

## Raiz

- `src/`: codigo fuente principal
- `public/`: assets estaticos y geojson
- `scripts/`: scripts node para generar datos de mapa
- `docs/`: esta documentacion

## `src/components`

- Componentes de UI reutilizables.
- Ejemplos:
  - `MapboxCostaMap.astro`
  - `PropertyCard.astro`
  - `PropertyHero.astro`
  - `GallerySection.astro`

## `src/pages`

- Rutas de Astro.
- Entrada principal: `src/pages/index.astro` redirige a idioma por defecto.
- Rutas multidioma: `src/pages/[lang]/...`

## `src/data`

- Contenido editable sin tocar logica de render.
- `src/data/properties`: promociones y unidades (JSON)
- `src/data/posts`: posts del blog (JSON)
- `src/data/team`: miembros del equipo (JSON)

## `src/utils`

- Normalizacion de datos y logica de filtros/mapa.
- Archivos mas sensibles:
  - `normalizeProperty.ts`
  - `normalizePropertyCard.ts`
  - `buildFilters.ts`
  - `applyFilters.ts`
  - `floorFilter.ts`
  - `buildMapFeatures.ts`

## `src/styles`

- CSS por pagina y por componente.
- `src/styles/pages/*.css`
- `src/styles/components/*.css`

## `public/data`

- `zones.geojson`: poligonos de ciudades/zonas para filtros de mapa
- `pois.geojson`: puntos de interes

