# Documentacion WEB-BR

Esta documentacion esta pensada para alguien que entra por primera vez al proyecto y necesita saber:

- como levantar la web
- que carpeta tocar para cada cambio
- como anadir propiedades, proyectos, posts y miembros del equipo
- como no romper filtros, mapa, slugs e idiomas

## Ruta recomendada de lectura

1. `docs/00-start-here/01-setup-local.md`
2. `docs/00-start-here/02-first-60-minutes.md`
3. `docs/10-architecture/01-repo-map.md`
4. `docs/10-architecture/02-routing-i18n.md`
5. `docs/20-content-models/01-properties.md`
6. `docs/30-playbooks/01-add-new-project.md`

## Estructura de esta documentacion

- `docs/00-start-here`
- `docs/10-architecture`
- `docs/20-content-models`
- `docs/30-playbooks`
- `docs/40-ops`
- `docs/50-crm`
- `docs/templates`

## Regla rapida: "que toco para X"

- Nuevo proyecto o vivienda: `src/data/properties/*.json`
- Orden de proyectos en la pestaña Proyectos: `src/pages/[lang]/projects/index.astro`
- Filtros (ciudad, planta, tipo, etc): `src/utils/buildFilters.ts` y `src/utils/applyFilters.ts`
- Logica de plantas (Planta baja, Atico, Villas): `src/utils/floorFilter.ts`
- Mapa (UI y comportamiento): `src/components/MapboxCostaMap.astro`
- Datos que van al mapa: `src/utils/buildMapFeatures.ts`
- Zonas del mapa: `public/data/zones.geojson`
- POIs del mapa: `public/data/pois.geojson`
- Posts: `src/data/posts/*.json` y `src/data/posts/index.ts`
- Paginas de posts: `src/pages/[lang]/posts/index.astro` y `src/pages/[lang]/post/[slug].astro`
- Equipo: `src/data/team/*.json` y `src/data/team/index.ts`
- Navegacion global: `src/layouts/BaseLayout.astro`
