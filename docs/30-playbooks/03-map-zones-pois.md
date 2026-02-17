# Playbook: mapa, zonas y POIs

## Archivos clave

- Componente mapa: `src/components/MapboxCostaMap.astro`
- Datos de puntos: `src/utils/buildMapFeatures.ts`
- Zonas: `public/data/zones.geojson`
- POIs: `public/data/pois.geojson`
- Scripts:
  - `scripts/fetch-zones-nominatim.mjs`
  - `scripts/fetch-pois-overpass.mjs`

## Cuando crear/actualizar zonas

Hazlo cuando:

- anades ciudad nueva
- cambia delimitacion municipal
- una propiedad cae fuera del poligono esperado

Comando:

- `npm run zones:fetch`

## Cuando crear/actualizar POIs

Hazlo cuando:

- quieres refrescar restaurantes, hospitales, colegios, etc.

Comando:

- `npm run pois:fetch`

## Reglas de visibilidad en el mapa

- Solo se muestran propiedades con `status: "available"`.
- Solo se muestran propiedades con coordenadas validas.
- Las unidades hijas no se pintan como marker independiente.

## Si quieres que un proyecto aparezca en una ciudad concreta

1. Revisa `location.city` y `location.area` en su JSON.
2. Revisa coordenadas lat/lng.
3. Verifica que el poligono de `public/data/zones.geojson` cubra ese punto.

