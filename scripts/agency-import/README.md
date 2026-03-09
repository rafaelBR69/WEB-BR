# Agency Import

Flujo local para preparar el modulo de agencias antes de tocar Supabase.

## Estructura

- `scripts/agency-import/input/`: CSV originales.
- `scripts/agency-import/jobs/default-agencies.json`: mapa de proyectos y fuentes.
- `scripts/agency-import/reference/`: salidas estables para revision.
- `scripts/agency-import/reports/`: reportes JSON por ejecucion.

## Scripts

### 1. Staging + deduplicacion

```bash
node scripts/build-agency-import-staging.mjs --job-file scripts/agency-import/jobs/default-agencies.json
```

Genera:

- `scripts/agency-import/reference/agency-staging-latest.csv`
- `scripts/agency-import/reference/agency-staging-deduped-latest.csv`
- `scripts/agency-import/reference/agency-staging-deduped-latest.json`

Regla de dedupe:

- `tax_id`
- `agency_name + email`
- `agency_name + phone`
- `legal_name + email`
- `agent_name + email/phone`
- fallback por fila origen

### 2. Match contra leads

```bash
node scripts/build-agency-lead-match-review.mjs --job-file scripts/agency-import/jobs/default-agencies.json
```

Genera:

- `scripts/agency-import/reference/agency-lead-match-review-latest.csv`

Clasificacion:

- `exact`: coincide por `email` o `phone`
- `candidate`: buen candidato por combinacion de nombres
- `manual_review`: parecido util, pero no suficientemente fuerte para automatizar

## Uso recomendado

1. Revisar `agency-staging-deduped-latest.csv`
2. Corregir nombres/correos raros si hace falta
3. Revisar `agency-lead-match-review-latest.csv`
4. Solo despues preparar import a `crm.contacts`, `crm.clients`, `crm.agencies` y enlace posterior con `crm.leads.agency_id`

## Nota operativa

No conviene enlazar automaticamente `leads` con agencias solo por nombre comercial.
El match fiable es:

- `email`
- `phone`
- o validacion manual con proyecto + agencia + agente
