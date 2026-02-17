# Playbook: anadir un proyecto nuevo

## Objetivo

Crear una promocion padre + sus unidades y dejarla operativa en:

- listado propiedades
- ficha proyecto
- pestaña proyectos
- mapa

## Paso 1: crear promocion padre

1. Copia `docs/templates/property-promotion.template.json`
2. Guarda como `src/data/properties/PMXXXX.json`
3. Rellena:
   - `id`, `slugs`, `status`, `listing_type`
   - `location` con coordenadas reales
   - `translations` por idioma
   - `media.cover` y galerias

## Paso 2: crear unidades hijas

1. Copia `docs/templates/property-unit.template.json`
2. Crea una por unidad, por ejemplo:
   - `src/data/properties/PMXXXX-A1.json`
   - `src/data/properties/PMXXXX-A2.json`
3. Asegura `parent_id: "PMXXXX"`
4. Rellena precio, m2, terraza, planta, etc.

## Paso 3: disponibilidad y estado

- Unidades no disponibles:
  - `status: "sold"` si ya vendida
  - `status: "private"` si no quieres mostrarla en web

## Paso 4: revisa proyectos destacados (opcional)

Si debe ir arriba de todo en la pestaña Proyectos:

- Edita `pinnedProjectOrder` en `src/pages/[lang]/projects/index.astro`

## Paso 5: revisar zona mapa

Si ciudad nueva no existe en zonas:

1. Regenera zonas: `npm run zones:fetch`
2. Verifica `public/data/zones.geojson`

## Paso 6: validar

1. `npm run dev`
2. Revisar:
   - `/{lang}/projects/`
   - `/{lang}/property/{slug-del-proyecto}/`
   - `/{lang}/properties/`
   - `/{lang}/map/`
3. `npm run build`

## Checklist rapido de errores comunes

- Falta slug en algun idioma.
- `parent_id` incorrecto.
- Coordenadas vacias o no numericas.
- `status` en `private` por error.
- JSON invalido (coma extra, comillas, etc).

