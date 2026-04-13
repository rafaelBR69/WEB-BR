## SEO Migration Workspace

Usa esta carpeta para las fuentes auxiliares de la migracion SEO.

### Estructura

- `scripts/seo-migration/input/`
  - exports crudos de herramientas externas
  - ejemplo: Ahrefs Page Explorer, Search Console, GA4, Semrush
- `scripts/seo-migration/reference/`
  - datasets ya normalizados o filtrados para trabajar
  - ejemplo: top-pages-ahrefs.csv, legacy-pages-priority.csv
- `scripts/seo-migration/reports/`
  - salidas derivadas, cruces y resúmenes

### Regla practica

- Los CSV maestros actuales siguen en la raiz del repo:
  - `seo_url_audit_master.csv`
  - `seo_url_legacy_redirect_map.csv`
  - `seo_url_legacy_gap_action_plan.csv`
  - `seo_migration_master_task_plan.csv`
- Los exports auxiliares no deben ir en la raiz.
- Todo CSV nuevo de Ahrefs o herramientas externas debe entrar primero en `input/`.

### Para Ahrefs

Coloca el export en:

- `scripts/seo-migration/input/`

Nombre recomendado:

- `ahrefs-page-explorer-top-pages-YYYY-MM-DD.csv`

Ejemplo:

- `scripts/seo-migration/input/ahrefs-page-explorer-top-pages-2026-04-10.csv`

### Flujo recomendado

1. Dejar el CSV original en `input/`.
2. Generar una copia limpia o reducida en `reference/` si hace falta.
3. Cruzarlo con `urls-antiguaweb.txt` y `seo_url_legacy_redirect_map.csv`.
4. Reflejar las decisiones finales en los CSV maestros de la raiz.

### Objetivo

Separar claramente:

- fuente maestra de migracion
- exportaciones temporales o auxiliares
- reportes de analisis
