# Import Leads CSV

Este flujo permite importar multiples CSV de leads a `crm.leads`, sincronizando con clientes ya existentes para evitar duplicados operativos.

## Estructura

- `scripts/lead-import/input/`: coloca aqui tus CSV.
- `scripts/lead-import/jobs/default-leads.json`: plantilla de job.
- `scripts/lead-import/reference/lead-source-catalog.csv`: catalogo maestro de canales detallados.
- `scripts/lead-import/reports/`: reportes JSON por ejecucion.

## Catalogo de canales

Antes de seguir ampliando reglas en el importador, el catalogo de referencia debe ser la fuente de verdad para:

- `channel_detail`: canal real de negocio que quieres medir (`idealista`, `formulario_web_br`, `landing`, etc.).
- `origin_type`: familia superior para agrupar (`portal`, `website`, `email`, `whatsapp`, etc.).
- `source_label`: etiqueta visible en dashboard.

Prioridad recomendada de lectura en CSV:

1. `CANAL DE ENTRADA`
2. `ORIGEN`
3. `Origen`
4. `Canal`

Regla funcional:

- si existe un canal detallado en `CANAL DE ENTRADA`, ese valor debe prevalecer para reporting
- `ORIGEN` debe actuar como fallback cuando el CSV no trae un canal detallado
- los registros marcados como `pending_business` en el catalogo no deben consolidarse automaticamente en una familia definitiva hasta validar criterio de negocio

## Reglas aplicadas

- Si una fila del CSV viene marcada como `cliente` o `baja`, se excluye.
- Si la identidad ya existe como cliente en CRM (tax id, email o telefono), se excluye.
- Si el lead ya existe, por defecto se omite; con `--update-existing` se actualiza.

## Ejecucion

```bash
node scripts/import-crm-leads.mjs --job-file scripts/lead-import/jobs/default-leads.json --dry-run
```

Ejecucion real:

```bash
node scripts/import-crm-leads.mjs --job-file scripts/lead-import/jobs/default-leads.json --continue-on-error
```

Opciones:

- `--organization-id <uuid>`
- `--dry-run`
- `--update-existing`
- `--continue-on-error`
- `--limit <n>`

## Backfill del historico

Dry-run del historico ya importado:

```bash
node scripts/lead-import/backfill-lead-sources.mjs
```

Aplicar cambios reales:

```bash
node scripts/lead-import/backfill-lead-sources.mjs --apply
```

Via npm:

```bash
npm run leads:backfill-sources
npm run leads:backfill-sources -- --apply
```

Comportamiento:

- por defecto solo evalua leads importados desde CSV
- reconstruye `source` y `origin_type` usando el catalogo maestro
- completa `raw_payload.channel`
- completa `raw_payload.project`
- si el catalogo sugiere `agency` o `provider` pero el lead no tiene `agency_id` o `provider_id`, se conserva el canal detallado y se persiste `origin_type=other` para no romper las reglas de base de datos
- solo religa `property_id` cuando hoy falta o no resuelve y puede inferirse con seguridad desde `property_legacy_code`

## Variables necesarias

- `SUPABASE_URL` (o `PUBLIC_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY`
