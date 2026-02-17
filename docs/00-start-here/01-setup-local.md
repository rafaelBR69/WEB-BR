# Setup local

## Requisitos

- Node.js 20 o superior
- npm
- acceso al `.env` del proyecto

## Instalacion

1. Desde la raiz del proyecto:
   `npm install`
2. Arrancar en local:
   `npm run dev`
3. Abrir:
   `http://localhost:4321`

## Variables de entorno

Archivo: `.env`

- `PUBLIC_MAPBOX_TOKEN`
- `PUBLIC_MAPBOX_STYLE`

Si falta el token, el mapa no renderiza correctamente.

## Comandos utiles

- Desarrollo: `npm run dev`
- Build produccion: `npm run build`
- Preview local build: `npm run preview`
- Regenerar POIs: `npm run pois:fetch`
- Regenerar zonas: `npm run zones:fetch`

## Nota importante sobre el mapa

El mapa usa dependencias optimizadas por Vite (`mapbox-gl`, `@turf/*`).  
Si ves errores de "Outdated Optimize Dep", revisa `docs/40-ops/02-troubleshooting.md`.

