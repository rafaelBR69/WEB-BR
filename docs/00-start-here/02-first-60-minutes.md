# Primeros 60 minutos

## Objetivo

Entender la estructura minima para poder trabajar sin romper nada.

## Paso 1: ubica las piezas core

- Layout global: `src/layouts/BaseLayout.astro`
- Rutas: `src/pages/[lang]/...`
- Datos: `src/data/...`
- Normalizacion y filtros: `src/utils/...`
- Estilos: `src/styles/...`

## Paso 2: entiende la entrada de datos

- Propiedades: `src/data/properties/*.json`
- Posts: `src/data/posts/*.json`
- Equipo: `src/data/team/*.json`

## Paso 3: entiende como se pintan

- Home: `src/pages/[lang]/index.astro`
- Listado propiedades: `src/pages/[lang]/properties/index.astro`
- Ficha propiedad: `src/pages/[lang]/property/[slug].astro`
- Proyectos: `src/pages/[lang]/projects/index.astro`
- Mapa: `src/components/MapboxCostaMap.astro`
- Posts: `src/pages/[lang]/posts/index.astro`

## Paso 4: primer cambio seguro de prueba

1. Cambia un titulo en un post de prueba en `src/data/posts/*.json`
2. Ejecuta `npm run dev`
3. Revisa la ruta `/{lang}/posts/`
4. Ejecuta `npm run build`

Si esto funciona, tu entorno esta listo.

