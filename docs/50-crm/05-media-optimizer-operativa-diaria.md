# Operativa diaria media optimizada

## Objetivo

Tener un flujo estable para publicar propiedades con imagenes optimizadas sin repetir trabajo.

## Regla clave

El script **no reoptimiza** imagenes ya optimizadas mientras `overwrite` sea `false`
(por defecto en `scripts/media-optimizer/jobs/default.json`).

## Configuracion base recomendada

Archivo:
- `scripts/media-optimizer/jobs/default.json`

Parametros activos:
- `path_strategy: "project_scoped"`
- `variant_placement: "folder"`
- `variants`:
  - `mobile` ancho `420`
  - `tablet` ancho `1020`
  - `desktop` ancho `1800`
- `primary_variant: "desktop"`

## Flujo para una propiedad nueva

1. Subir imagenes de la propiedad en CRM.
2. Ejecutar dry-run solo para esa propiedad:
`npm run properties:media-optimize -- -- --dry-run --legacy-codes PMXXXX`
3. Ejecutar apply solo para esa propiedad:
`npm run properties:media-optimize -- -- --apply --legacy-codes PMXXXX`
4. Revisar reporte en:
`scripts/media-optimizer/reports/`

## Automatizacion con cola (recomendado)

El CRM encola automaticamente un job de optimizacion cuando:
- subes un archivo por `POST /api/v1/properties/:id/media/upload`
- agregas una URL por `POST /api/v1/properties/:id/media`

Requisito previo:
- aplicar `supabase/sql/005_media_optimize_queue.sql`

Worker de cola:
`npm run properties:media-optimize-queue -- --max-jobs 5`

Para ejecucion continua en segundo plano (produccion), programa este comando cada 1-2 minutos
con Task Scheduler/cron/PM2.

Variables opcionales:
- `CRM_MEDIA_OPTIMIZER_QUEUE_ENABLED=true` activa/desactiva cola
- `CRM_MEDIA_OPTIMIZER_QUEUE_AUTO_KICK=true` intenta arrancar worker tras cada alta de media
- `CRM_MEDIA_OPTIMIZER_QUEUE_AUTO_KICK_MAX_JOBS=1` jobs por auto-arranque
- `CRM_MEDIA_OPTIMIZER_QUEUE_AUTO_KICK_THROTTLE_MS=5000` anti-spam de auto-arranque

## Flujo diario por lote (varias propiedades nuevas)

Dry-run:
`npm run properties:media-optimize -- -- --dry-run`

Apply:
`npm run properties:media-optimize -- -- --apply`

Al estar `overwrite=false`, las ya optimizadas se saltan automaticamente.

## Reoptimizar forzando (solo cuando quieras regenerar)

`npm run properties:media-optimize -- -- --apply --overwrite`

## Validacion rapida de salida

En el reporte JSON revisa:
- `unique_urls_eligible` (candidatas)
- `unique_urls_optimized` (optimizadas de verdad)
- `skipped_already_optimized` (ya optimizadas y omitidas)
- `errors` (debe quedar vacio)

## Como usa la web estas variantes

La web detecta rutas optimizadas y sirve por dispositivo:
- movil -> `mobile` (`420w`)
- tablet -> `tablet` (`1020w`)
- escritorio -> `desktop` (`1800w`)

Implementado en:
- `src/utils/supabaseImage.ts`

Componentes que ya consumen esta logica (sin cambios manuales adicionales):
- `src/components/PropertyHero.astro`
- `src/components/PropertyCard.astro`
- `src/components/GallerySection.astro`
- `src/components/LightboxGallery.astro`
- `src/utils/buildMapFeatures.ts`
