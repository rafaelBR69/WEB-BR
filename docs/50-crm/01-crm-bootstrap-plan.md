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
