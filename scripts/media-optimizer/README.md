# CRM media optimizer (Sharp)

Este directorio contiene jobs para optimizar imagenes de propiedades en `crm.properties.media`
sin pegar URLs manualmente.

## Archivo de trabajo

- `scripts/media-optimizer/jobs/default.json`

Puedes duplicarlo para crear jobs por proyecto, por ejemplo:
- `scripts/media-optimizer/jobs/whitehills.json`
- `scripts/media-optimizer/jobs/manilva.json`

## Ejecucion

Dry-run:
`node scripts/optimize-crm-property-media.mjs --job-file scripts/media-optimizer/jobs/default.json --dry-run`

Apply:
`node scripts/optimize-crm-property-media.mjs --job-file scripts/media-optimizer/jobs/default.json --apply`

Reubicar optimizados antiguos hash a estructura por proyecto:
`node scripts/optimize-crm-property-media.mjs --apply --overwrite --path-strategy project_scoped --variant-placement folder --source-map-report latest`

Nota:
- Con `overwrite=false` (default) se saltan imagenes ya optimizadas.
- Usa `--overwrite` solo cuando necesites regenerar variantes.

Se genera un reporte JSON en:
- `scripts/media-optimizer/reports/`

## Cola automatica (CRM)

Cuando el CRM guarda media (`/api/v1/properties/:id/media` y `/media/upload`), encola
un job para optimizar en segundo plano.
Antes de usar la cola, aplica:
`supabase/sql/005_media_optimize_queue.sql`

Worker de cola (manual):
`node scripts/process-media-optimize-queue.mjs --max-jobs 5`

Via npm:
`npm run properties:media-optimize-queue -- --max-jobs 5`

Variables opcionales:
- `CRM_MEDIA_OPTIMIZER_QUEUE_ENABLED=true`
- `CRM_MEDIA_OPTIMIZER_QUEUE_AUTO_KICK=true`
- `CRM_MEDIA_OPTIMIZER_QUEUE_AUTO_KICK_MAX_JOBS=1`
- `CRM_MEDIA_OPTIMIZER_QUEUE_AUTO_KICK_THROTTLE_MS=5000`
