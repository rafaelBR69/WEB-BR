# Optimizar media CRM con Sharp

## Objetivo

Automatizar este flujo sin copiar/pegar URLs:

1. Subes imagenes al CRM (Storage + `crm.properties.media`).
2. Un script lee esas URLs desde la base de datos.
3. Genera versiones optimizadas con `sharp`.
4. Sube optimizados a Storage.
5. Actualiza `crm.properties.media` para que la web use la version optimizada.

## Archivo que ejecuta el proceso

- `scripts/optimize-crm-property-media.mjs`

## Directorio de configuracion (jobs)

- `scripts/media-optimizer/jobs/default.json`
- Opcional: crea mas jobs, por ejemplo:
  - `scripts/media-optimizer/jobs/whitehills.json`
  - `scripts/media-optimizer/jobs/manilva.json`

## Configuracion minima del job

Archivo: `scripts/media-optimizer/jobs/default.json`

Campos clave:
- `organization_id`: UUID de `crm.organizations.id` (si lo dejas vacio usa `CRM_ORGANIZATION_ID` del `.env`).
- `bucket`: bucket origen (normalmente `properties`).
- `target_prefix`: carpeta destino de optimizados (`optimized/v1`).
- `path_strategy`:
  - `hashed`: carpeta global con hash (modo antiguo).
  - `project_scoped`: guarda dentro de cada proyecto/propiedad.
- `variant_placement`:
  - `suffix`: `imagen-desktop.webp`
  - `folder`: `desktop/imagen.webp` (mantiene nombre base)
- `source_map_report`: ruta de reporte previo para mapear URLs optimizadas antiguas a su origen.
  - recomendado: `"latest"`
- `legacy_codes`: filtra por propiedades concretas (opcional).
- `variants`: versiones a generar (ej. `card`, `hero`).
- `primary_variant`: la URL de esta variante se guarda en `media.url`.

## Comandos

Dry-run (recomendado primero):
`node scripts/optimize-crm-property-media.mjs --job-file scripts/media-optimizer/jobs/default.json --dry-run`

Aplicar cambios:
`node scripts/optimize-crm-property-media.mjs --job-file scripts/media-optimizer/jobs/default.json --apply`

Via npm script:
`npm run properties:media-optimize -- -- --dry-run`

`npm run properties:media-optimize -- -- --apply`

Nota: en npm usa `-- --` antes de los flags del script.

## Worker de cola (automatizar desde CRM)

El CRM encola automaticamente trabajos de optimizacion al subir/agregar media.
Antes de usarlo, aplica la migracion:
`supabase/sql/005_media_optimize_queue.sql`

Procesar cola manualmente:
`npm run properties:media-optimize-queue -- --max-jobs 5`

Para produccion, programa ese comando cada 1-2 minutos.

## Reubicar optimizados antiguos (hash) a estructura por proyecto

Si ya ejecutaste un `apply` antiguo y te creo rutas tipo `optimized/v1/<hash>...`,
puedes reubicar usando el ultimo reporte automaticamente:

`npm run properties:media-optimize -- -- --apply --overwrite --path-strategy project_scoped --variant-placement folder --source-map-report latest`

Con eso:
- usa el mapeo `new_url -> source_url` del reporte
- vuelve a generar variantes
- las guarda en estructura por proyecto con nombre legible
- actualiza `crm.properties.media` con la nueva URL principal

## Reportes

Cada ejecucion crea un reporte JSON en:
- `scripts/media-optimizer/reports/`

Incluye:
- resumen de propiedades y URLs analizadas
- URLs optimizadas
- errores detectados por propiedad/media

## Recomendacion operativa

1. Subir media desde CRM.
2. Ejecutar `dry-run` y revisar reporte.
3. Ejecutar `apply`.
4. Revisar una ficha publica y listado para confirmar que ya carga optimizados.

Guia diaria resumida:
- `docs/50-crm/05-media-optimizer-operativa-diaria.md`
