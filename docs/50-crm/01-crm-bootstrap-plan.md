# CRM bootstrap plan

## Objetivo inicial

Lanzar un CRM minimo dentro del mismo repo, separado de la web publica, con:

- UI basica en `/crm/*`
- endpoints base en `/api/v1/*`
- modelo SQL inicial en Supabase para leads, clientes, propiedades (venta + alquiler), contratos, documentos y facturacion

## Separacion clara en el proyecto

- Web publica: `src/pages/[lang]/*`
- CRM UI: `src/pages/crm/*`
- CRM API: `src/pages/api/v1/*`
- Utilidades API CRM: `src/utils/crmApi.ts`
- SQL Supabase: `supabase/sql/001_crm_core.sql`

## Fases de trabajo

1. Fase 0 (lista):
- Skeleton CRM con layout y estilos base.
- Endpoints mock listos para GET/POST.
- Esquema SQL base preparado para Supabase.

2. Fase 1 (siguiente):
- Instalar `@supabase/supabase-js`.
- Conectar endpoints `/api/v1/*` a tablas reales.
- Crear auth de CRM (login + roles por organizacion).

3. Fase 2:
- Migrar propiedades JSON actuales a `crm.properties`.
- Marcar promociones padre (`record_type=project`) y unidades (`record_type=unit`).
- Incluir propiedades de alquiler (`operation_type='rent'` + `price_rent_monthly`).

4. Fase 3:
- Integrar formularios de la web publica para crear leads reales en `crm.leads`.
- Pipeline comercial, asignacion de agentes, actividades.

5. Fase 4:
- Contratos, documentos y facturacion conectados a flujo comercial.
- Cuadros de mando y reportes.

## Comandos para verlo en local

1. Instalar dependencias:
`npm install`

2. Levantar en puerto por defecto:
`npm run dev`

3. Abrir:
- CRM: `http://localhost:4321/crm/`
- API health: `http://localhost:4321/api/v1/health`

4. Si quieres otro puerto:
`npm run dev -- --port 4322`

## SQL en Supabase

1. Abrir SQL Editor en Supabase.
2. Ejecutar completo: `supabase/sql/001_crm_core.sql`.
3. Revisar que tablas y tipos del schema `crm` se hayan creado.
4. (Opcional) usar ejemplos de carga inicial: `supabase/sql/002_bootstrap_examples.sql`.
5. Si ya habias ejecutado `001` antes, aplicar cambios incrementales: `supabase/sql/003_property_business_type.sql`.
6. Para la fase 1 de clientes, aplicar tambien: `supabase/sql/006_clients_profile_and_documents.sql`.
7. Para la fase 2 de clientes (proveedor/agencia fuertes), aplicar tambien: `supabase/sql/007_clients_phase2_provider_agency_links.sql`.

## Migrar JSON de propiedades al CRM

Archivo que ejecuta la sincronizacion:
- `scripts/migrate-properties-json-to-crm.mjs`

Comando recomendado (directo con Node):
`node scripts/migrate-properties-json-to-crm.mjs --organization-id <ORG_UUID>`

Comando equivalente via npm script:
`npm run properties:migrate-crm -- -- --organization-id <ORG_UUID>`

Nota: en npm debes pasar `-- --` antes de los flags del script para que npm no los interprete como flags propios.

1. Definir variables de entorno:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRM_ORGANIZATION_ID` (UUID de `crm.organizations.id`)
- `CRM_WEBSITE_ID` (opcional, UUID de `crm.websites.id`)

2. Validar mapeo sin escribir:
`node scripts/migrate-properties-json-to-crm.mjs --dry-run --organization-id <ORG_UUID>`

o via npm:
`npm run properties:migrate-crm -- -- --dry-run --organization-id <ORG_UUID>`

3. Ejecutar migracion real:
`node scripts/migrate-properties-json-to-crm.mjs --organization-id <ORG_UUID>`

o via npm:
`npm run properties:migrate-crm -- -- --organization-id <ORG_UUID>`

4. (Opcional) migrar solo una muestra inicial:
`node scripts/migrate-properties-json-to-crm.mjs --organization-id <ORG_UUID> --limit 20`

o via npm:
`npm run properties:migrate-crm -- -- --organization-id <ORG_UUID> --limit 20`

## Optimizar imagenes CRM con Sharp

Archivo:
- `scripts/optimize-crm-property-media.mjs`

Job por directorio:
- `scripts/media-optimizer/jobs/default.json`

Dry-run:
`npm run properties:media-optimize -- -- --dry-run`

Aplicar:
`npm run properties:media-optimize -- -- --apply`

Guia completa:
- `docs/50-crm/04-media-optimizer-sharp.md`
- `docs/50-crm/05-media-optimizer-operativa-diaria.md`

## Orden recomendado de despliegue

1. Ejecutar primero el SQL del schema (no requiere usuarios previos para crear tablas).
2. Crear tu usuario admin en Supabase Auth (Dashboard o invite).
3. Crear una organizacion en `crm.organizations`.
4. Crear membership admin vinculando `auth.users.id` en `crm.memberships`.
5. Cargar clientes/proveedores y despues proyectos/unidades.

## Proveedores en este esquema

- Un proveedor es un cliente facturable: `crm.providers.client_id -> crm.clients.id`.
- Un proveedor se ancla a promociones padre en `crm.project_providers`.
- La tabla `crm.project_providers` valida que el inmueble destino sea `record_type='project'`.
- En `crm.properties.project_business_type` se diferencia:
  - `owned_and_commercialized`: promocion propia.
  - `provider_and_commercialized_by_us`: promocion de proveedor comercializada por nosotros.
  - `external_listing`: captacion externa tradicional.

## Agencias y abogados

- Una agencia tambien es cliente facturable: `crm.agencies.client_id -> crm.clients.id`.
- Los contactos de una agencia (agente, abogado, asistente, propietario) se guardan en `crm.agency_contacts`.
- Se permite marcar relaciones descartadas en `crm.agency_contacts.relation_status`.

## Leads con estados reales

- El lead soporta origen y referencia:
  - `origin_type` (`agency`, `provider`, `website`, etc)
  - `agency_id` / `provider_id`
  - `referred_contact_id` (por ejemplo abogado o agente que lo trae)
- Estados de lead soportados:
  - `new`, `in_process`, `qualified`, `visit_scheduled`, `offer_sent`, `negotiation`, `converted`, `won`, `lost`, `discarded`, `junk`
- Si `origin_type='agency'` se exige `agency_id`; si `origin_type='provider'` se exige `provider_id`.
- Conversion directa lead -> agencia: `select crm.convert_lead_to_agency('<lead_uuid>');`

## Clientes fase 1 (operativo)

- Endpoint listado/alta: `GET/POST /api/v1/clients`.
- Endpoint detalle/edicion: `GET/PATCH /api/v1/clients/{id}`.
- Endpoint documentos cliente: `GET /api/v1/clients/{id}/documents`.
- Endpoint upload documental: `POST /api/v1/clients/{id}/documents/upload`.
- Carpeta Storage por cliente:
  - `org/{organization_id}/client/{client_id}/{subject_type}/{document_kind}/{yyyy}/{mm}/...`
- `subject_type` soportado:
  - `client`, `provider`, `agency`, `other`.
- `document_kind` soportado:
  - `dni_front`, `dni_back`, `nie_front`, `nie_back`, `passport`, `cif`,
    `bank_proof`, `reservation`, `contract`, `authorization`, `other`.

## Clientes fase 2 (proveedor/agencia)

- El cliente puede vincularse como proveedor y/o agencia desde la misma ficha.
- API lista clientes con metadatos de rol:
  - `is_provider`, `provider_*`
  - `is_agency`, `agency_*`
  - `is_provider_for_project` (cuando filtras por promocion).
- Filtros nuevos en `GET /api/v1/clients`:
  - `client_role`: `provider`, `agency`, `provider_or_agency`, `client_only`.
  - `project_id`: UUID de promocion para devolver clientes vinculados a esa promocion.
    Incluye:
    - proveedores vinculados por `crm.project_providers`,
    - y compradores/importaciones de reservas vinculados por `crm.client_project_reservations`.
- La migracion `007_clients_phase2_provider_agency_links.sql` agrega triggers que impiden
  relacionar `crm.providers` o `crm.agencies` con clientes de otra organizacion.

## Clientes fase 2B (reservas comprador por promocion)

- Migracion: `supabase/sql/008_clients_project_reservations.sql`.
- Nueva tabla: `crm.client_project_reservations`.
  - Relaciona `client_id` <-> `project_property_id` con estado/fechas/importes/comisiones/checklist documental.
  - Guarda `source_file` + `source_row_number` para trazabilidad e idempotencia por fila importada.
  - Trigger de consistencia por organizacion:
    - valida cliente/proyecto en la misma `organization_id`,
    - valida que el destino sea `record_type='project'`.

## Importar clientes por promocion (script)

- Script: `scripts/import-crm-project-clients.mjs`
- Plantilla job: `scripts/client-import/jobs/default-project-clients.json`
- Dry-run:
  - `node scripts/import-crm-project-clients.mjs --job-file=scripts/client-import/jobs/default-project-clients.json --dry-run`
- Aplicar:
  - `node scripts/import-crm-project-clients.mjs --job-file=scripts/client-import/jobs/default-project-clients.json`
- El script:
  - crea o reutiliza `crm.clients` y `crm.providers`,
  - y vincula proveedor -> promocion en `crm.project_providers`.

## Importar reservas comprador -> promocion (CSV)

- Script: `scripts/import-crm-client-reservations.mjs`
- Plantilla job: `scripts/client-import/jobs/default-client-reservations.json`
- Dry-run:
  - `node scripts/import-crm-client-reservations.mjs --job-file=scripts/client-import/jobs/default-client-reservations.json --dry-run`
- Aplicar:
  - `node scripts/import-crm-client-reservations.mjs --job-file=scripts/client-import/jobs/default-client-reservations.json --continue-on-error`
- Nota npm:
  - En algunas shells Windows puede requerir triple separador para pasar flags:
    `npm run clients:import-reservations -- -- --job-file=scripts/client-import/jobs/default-client-reservations.json --dry-run`
- El script:
  - parsea CSVs con cabeceras irregulares/multilinea,
  - crea o reutiliza `crm.clients`,
  - y registra la vinculacion de reserva en `crm.client_project_reservations`.

## Flujo operativo padre/hijas (CRM)

Objetivo: que comercial no tenga que memorizar codigos para crear unidades.

1. Crear primero la promocion padre (`record_type='project'`).
2. Crear viviendas hijas (`record_type='unit'`) desde:
   - botones `Nueva hija` en dashboard/listado/detalle de promocion, o
   - alta manual en `/crm/properties/nueva/` eligiendo la promocion en selector guiado.
3. El campo manual `parent_legacy_code` queda como fallback si la promocion no aparece en lista.
4. La API valida que:
   - para `unit` haya padre informado,
   - el padre exista,
   - el padre sea una promocion (`record_type='project'`).
5. Si una propiedad pasa a `single` o `project`, se limpia `parent_property_id`.
