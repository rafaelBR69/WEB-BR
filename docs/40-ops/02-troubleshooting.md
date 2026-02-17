# Troubleshooting

## Error mapa: 504 Outdated Optimize Dep

Sintoma tipico:

- `Failed to load resource ... Outdated Optimize Dep`
- `Failed to fetch dynamically imported module mapbox-gl.js`

### Solucion recomendada

1. Parar servidor dev.
2. Borrar cache Vite:
   - `node_modules/.vite`
3. Relanzar:
   - `npm run dev`

Si persiste:

1. Borrar `node_modules`
2. `npm install`
3. `npm run dev`

## "Could not import /src/data/properties/XXXX.json"

Causa frecuente:

- Habia un import estatico apuntando a archivo borrado.

Estado actual del proyecto:

- `src/data/properties/index.ts` usa `import.meta.glob`, por lo que normalmente borrar un JSON ya no rompe imports.

Si sale error:

- revisa que no haya otro archivo con import directo al JSON borrado
- revisa que no quede referencia en rutas o scripts internos

## No aparece un post nuevo

Revisa:

1. Esta importado en `src/data/posts/index.ts`
2. Tiene `status: "published"`
3. Tiene slug y traduccion en el idioma actual

## No aparece una propiedad en mapa

Revisa:

1. `status` debe ser `available`
2. Debe tener `location.coordinates.lat` y `lng` numericos
3. Si es unidad hija (`parent_id`), no se pinta como marker individual

## Filtro de planta muestra valores raros

Revisa:

1. `property.floor_label`
2. `property.floor_level`
3. Normalizacion en `src/utils/floorFilter.ts`

