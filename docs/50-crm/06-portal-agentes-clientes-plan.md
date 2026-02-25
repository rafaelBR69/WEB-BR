# Plan de implementacion Portal de Agentes y Clientes

## Objetivo

Construir un modulo de portal integrado con el CRM para que:

- agentes externos y clientes accedan con email + password + codigo de invitacion.
- el acceso se limite por organizacion y por promocion.
- todo el contenido (documentos, updates, unidades, formularios) se gestione desde CRM.
- el sistema tenga trazabilidad y seguridad fuerte (RLS, auditoria, codigos hash, expiracion, bloqueo).

## Estado actual (base ya disponible)

- CRM operativo con schema `crm` y RLS por organizacion.
- tablas clave ya existentes: `crm.organizations`, `crm.memberships`, `crm.contacts`, `crm.clients`, `crm.agencies`, `crm.properties`, `crm.documents`, `crm.leads`.
- web publica y CRM ya conviven en el mismo repo:
  - web: `src/pages/[lang]/*`
  - crm: `src/pages/crm/*`
  - api: `src/pages/api/v1/*`

## Decision funcional clave

No usar un codigo global compartido para todos los usuarios.

Modelo recomendado:

1. invitacion individual por email (mas seguro).
2. codigo asociado a invitacion con hash (no guardar codigo en texto plano).
3. opcion secundaria: codigo por promocion para pre-registro, pero siempre termina en invitacion individual y validacion final en CRM.

## Alcance MVP (Sprint 4)

1. Registro y login portal:
- email + password + codigo valido.
- verificacion de cuenta y activacion.

2. Roles portal:
- `portal_agent_admin`
- `portal_agent_member`
- `portal_client`

3. Permisos por promocion:
- un usuario puede ver una o varias promociones.
- cada promocion define que contenido ve (agente vs cliente).

4. Backoffice CRM:
- generar/revocar invitaciones.
- asignar usuarios a promociones.
- publicar contenido por promocion e idioma.
- revisar logs de accesos/intentos.

5. Seguridad base:
- RLS activa en todas las tablas nuevas.
- codigo de invitacion con hash + expiracion + maximos intentos.
- bitacora de eventos de seguridad.

6. Tracking de lead para colaborador externo:
- timeline visible por lead: `recibido`, `aceptado`, `rechazado_duplicado`, `visita_programada`, `visita_realizada`, `oferta`, `reservado_arras`, `cerrado`, `perdido`, `comision_pagada`.

7. Reglas anti-duplicados y atribucion:
- regla base: primer registro valido con evidencia minima.
- ventana de disputa configurable: 24h a 72h.
- salida clara cuando el lead ya existe: `lead_existente_no_atribuido` o `revision_manual`.

8. Colaboracion y comision visible:
- condiciones de colaboracion por proyecto.
- estado de comision por lead/deal: `pendiente`, `aprobada`, `pagada`.

## Flujo real del portal (acordado)

1. Biblioteca controlada:
- el agente ve `Agency Kit` y `Client Kit` por proyecto.
- todo con permisos por rol y por promocion.

2. Entrada de lead con trazabilidad:
- crea lead con timestamp, proyecto, datos de cliente, idioma, presupuesto, timeline y notas.
- guarda metadatos de consentimiento y origen de envio.

3. Visitas sin caos:
- modelo recomendado MVP: solicitud de 2 o 3 slots y confirmacion por equipo interno.
- modelo futuro opcional: reserva directa de slot libre.

4. Gestion interna en CRM:
- comercial interno recibe lead atribuido + proyecto + agente colaborador + estado de visita.
- el cierre comercial completo sigue en CRM interno (cualificacion, oferta, arras, notaria).

## Minimo util para adopcion del agente externo

1. Estado del lead en tiempo real (timeline simple).
2. Regla de atribucion visible y estable (anti conflictos).
3. Visibilidad basica de colaboracion/comision (sin opacidad).

## Modelo de datos incremental (SQL)

Crear migraciones nuevas:

- `supabase/sql/010_portal_core.sql`
- `supabase/sql/011_portal_content.sql`
- `supabase/sql/012_portal_rls_policies.sql`

### 1) Tabla `crm.portal_accounts`

Proposito: perfil portal vinculado a `auth.users` y a entidades CRM.

Campos recomendados:

- `id uuid pk`
- `organization_id uuid not null -> crm.organizations`
- `auth_user_id uuid not null unique -> auth.users`
- `contact_id uuid null -> crm.contacts`
- `client_id uuid null -> crm.clients`
- `agency_id uuid null -> crm.agencies`
- `role text not null` (`portal_agent_admin`, `portal_agent_member`, `portal_client`)
- `status text not null` (`pending`, `active`, `blocked`, `revoked`)
- `last_login_at timestamptz`
- `created_at`, `updated_at`

### 2) Tabla `crm.portal_invites`

Proposito: control de invitaciones y codigos.

Campos recomendados:

- `id uuid pk`
- `organization_id uuid not null`
- `email text not null`
- `invite_type text not null` (`agent`, `client`)
- `role text not null`
- `project_property_id uuid null -> crm.properties` (promocion padre)
- `code_hash text not null`
- `code_last4 text not null`
- `expires_at timestamptz not null`
- `max_attempts smallint not null default 5`
- `attempt_count smallint not null default 0`
- `used_at timestamptz null`
- `revoked_at timestamptz null`
- `created_by uuid -> auth.users`
- `created_at`, `updated_at`

Indices clave:

- `(organization_id, lower(email), expires_at)`
- `(organization_id, project_property_id)`
- `(organization_id, revoked_at, used_at)`

### 3) Tabla `crm.portal_memberships`

Proposito: permisos de cada cuenta sobre promociones concretas.

Campos recomendados:

- `id uuid pk`
- `organization_id uuid not null`
- `portal_account_id uuid not null -> crm.portal_accounts`
- `project_property_id uuid not null -> crm.properties`
- `access_scope text not null` (`read`, `read_write`, `full`)
- `status text not null` (`active`, `paused`, `revoked`)
- `permissions jsonb not null default '{}'`
- `created_by uuid -> auth.users`
- `created_at`, `updated_at`

Restricciones:

- `unique (portal_account_id, project_property_id)`
- trigger para asegurar `project_property_id` con `record_type='project'`.

### 4) Tabla `crm.portal_content_blocks`

Proposito: contenido gestionado desde CRM por promocion, idioma y audiencia.

Campos recomendados:

- `id uuid pk`
- `organization_id uuid not null`
- `project_property_id uuid not null`
- `language text not null` (`es`, `en`, `de`, `fr`, `it`, `nl`)
- `audience text not null` (`agent`, `client`, `both`)
- `section_key text not null` (`hero`, `estado_obra`, `docs_legales`, `ventas`, etc.)
- `title text`
- `body_markdown text`
- `media jsonb not null default '{}'`
- `sort_order integer not null default 0`
- `is_published boolean not null default false`
- `published_at timestamptz`
- `created_by uuid -> auth.users`
- `updated_by uuid -> auth.users`
- `created_at`, `updated_at`

### 5) Tabla `crm.portal_access_logs`

Proposito: auditoria y seguridad.

Campos recomendados:

- `id uuid pk`
- `organization_id uuid not null`
- `portal_account_id uuid null`
- `email text`
- `event_type text not null` (`invite_sent`, `signup_ok`, `signup_fail`, `login_ok`, `login_fail`, `code_fail`, `blocked`, `logout`)
- `ip inet`
- `user_agent text`
- `metadata jsonb not null default '{}'`
- `created_at timestamptz not null default now()`

### 6) Extension sobre `crm.documents`

Agregar columnas para portal:

- `portal_visibility text not null default 'crm_only'` (`crm_only`, `agent`, `client`, `both`)
- `project_property_id uuid null -> crm.properties`
- `portal_is_published boolean not null default false`
- `portal_published_at timestamptz null`

### 7) Tabla `crm.portal_lead_tracking`

Proposito: trazabilidad externa y regla de atribucion de lead.

Campos recomendados:

- `id uuid pk`
- `organization_id uuid not null`
- `lead_id uuid not null -> crm.leads`
- `project_property_id uuid not null -> crm.properties`
- `portal_account_id uuid not null -> crm.portal_accounts`
- `attribution_status text not null` (`pending_review`, `attributed`, `rejected_duplicate`, `existing_client`, `manual_review`)
- `duplicate_of_lead_id uuid null -> crm.leads`
- `dispute_until timestamptz null`
- `evidence jsonb not null default '{}'`
- `created_at`, `updated_at`

Restricciones:

- `unique (organization_id, lead_id)`

### 8) Tabla `crm.portal_visit_requests`

Proposito: coordinacion de visitas desde portal.

Campos recomendados:

- `id uuid pk`
- `organization_id uuid not null`
- `lead_id uuid not null -> crm.leads`
- `project_property_id uuid not null -> crm.properties`
- `portal_account_id uuid not null -> crm.portal_accounts`
- `request_mode text not null` (`proposal_slots`, `direct_booking`)
- `proposed_slots jsonb not null default '[]'`
- `confirmed_slot timestamptz null`
- `status text not null` (`requested`, `confirmed`, `declined`, `done`, `no_show`, `cancelled`)
- `notes text`
- `created_at`, `updated_at`

### 9) Tabla `crm.portal_commission_status`

Proposito: visibilidad de colaboracion/comision por lead/deal.

Campos recomendados:

- `id uuid pk`
- `organization_id uuid not null`
- `lead_id uuid null -> crm.leads`
- `deal_id uuid null -> crm.deals`
- `project_property_id uuid not null -> crm.properties`
- `portal_account_id uuid not null -> crm.portal_accounts`
- `commission_type text not null` (`percent`, `fixed`)
- `commission_value numeric`
- `currency text default 'EUR'`
- `status text not null` (`pending`, `approved`, `paid`, `cancelled`)
- `payment_date date null`
- `notes text`
- `created_at`, `updated_at`

## Seguridad (obligatoria en MVP)

1. RLS por organizacion y membresia:
- `crm.user_has_org_access(...)` para usuarios internos CRM.
- nueva funcion `crm.portal_has_project_access(project_id uuid)` para usuarios portal.

2. Codigos de acceso:
- nunca en claro.
- guardar `code_hash` con algoritmo fuerte.
- comparar siempre en servidor.

3. Anti abuso:
- limitar intentos por invitacion e IP.
- bloqueo temporal tras fallos repetidos.
- expiracion corta (ej: 72h).

4. Auth y sesiones:
- password policy fuerte.
- confirmar email.
- MFA opcional para portal y recomendada para CRM admins.

5. Storage privado:
- docs portal en bucket privado.
- descarga con signed URLs de corta duracion.

6. Trazabilidad:
- registrar eventos en `crm.portal_access_logs`.
- log de cambios sensibles (revocaciones, cambios de rol, publicaciones).

## APIs a construir

Nuevos endpoints propuestos:

- `POST /api/v1/portal/invites` crear invitacion
- `GET /api/v1/portal/invites` listado invitaciones
- `POST /api/v1/portal/invites/{id}/revoke` revocar
- `POST /api/v1/portal/auth/activate` activar cuenta con email/password/codigo
- `POST /api/v1/portal/auth/validate-code` validar codigo previo a alta
- `GET /api/v1/portal/me` perfil portal actual
- `GET /api/v1/portal/projects` promociones accesibles por usuario portal
- `GET /api/v1/portal/projects/{id}/content` contenido publicado
- `GET /api/v1/portal/projects/{id}/documents` documentos visibles
- `POST /api/v1/portal/projects/{id}/leads` solicitud de informacion desde portal
- `GET /api/v1/portal/leads` listado de leads del colaborador autenticado
- `GET /api/v1/portal/leads/{id}` detalle + timeline visible
- `POST /api/v1/portal/leads/{id}/visit-requests` solicitar visita con slots
- `PATCH /api/v1/portal/visit-requests/{id}` confirmar/rechazar visita (equipo interno)
- `GET /api/v1/portal/commissions` estado de colaboracion/comisiones
- `GET /api/v1/portal/access-logs` (solo CRM admin/legal)

## Frontend/UX a construir

### CRM backoffice

Rutas sugeridas:

- `src/pages/crm/portal/index.astro` (dashboard)
- `src/pages/crm/portal/invites.astro`
- `src/pages/crm/portal/users.astro`
- `src/pages/crm/portal/content.astro`
- `src/pages/crm/portal/logs.astro`

Capacidades:

- filtrar por promocion/rol/estado.
- alta rapida de invitaciones.
- publicacion de contenido por idioma y audiencia.
- gestion de regla anti-duplicados y resolucion de disputas.
- gestion de solicitudes de visita (confirmar/rechazar, no show, realizada).
- gestion de condiciones y estado de comisiones.
- auditoria de accesos y errores.

### Portal publico autenticado

Rutas sugeridas:

- `src/pages/[lang]/portal/login.astro`
- `src/pages/[lang]/portal/activate.astro`
- `src/pages/[lang]/portal/index.astro`
- `src/pages/[lang]/portal/project/[id].astro`

Capacidades:

- login y activacion.
- selector de promociones disponibles.
- visualizacion de contenido/documentos segun rol.
- formulario de solicitud conectado a `crm.leads`.
- tracking de estado del lead en formato timeline simple.
- solicitud de visita con propuesta de slots.
- vista de estado de colaboracion/comision.

## Plan por fases y tareas

## Fase 0 - Definicion funcional (2 dias)

- cerrar roles finales y matriz de permisos.
- cerrar flujo exacto de registro.
- cerrar campos minimos de contenido por promocion.
- cerrar estados del timeline y SLA de actualizacion interna.
- cerrar regla de duplicados y ventana de disputa (24h/48h/72h).
- cerrar politica de visibilidad de comision.
- definir copy legal (privacidad, cookies, uso de datos).

Entrega:

- checklist firmado de alcance MVP.

## Fase 1 - Datos y seguridad base (3-4 dias)

- crear `010_portal_core.sql`.
- crear `011_portal_content.sql`.
- crear `012_portal_rls_policies.sql`.
- crear tablas de tracking/visitas/comisiones portal.
- triggers de consistencia organizacion/promocion.
- triggers de anti-duplicado y conflicto de atribucion.
- funciones SQL de validacion y acceso.

Entrega:

- migraciones aplicadas en entorno dev.
- pruebas SQL de acceso correcto/incorrecto.

## Fase 2 - APIs backend (4-5 dias)

- implementar endpoints de invitaciones.
- implementar endpoints de activacion/login portal.
- implementar endpoints de contenido/documentos por promocion.
- implementar endpoints de tracking de lead y visitas.
- implementar endpoint de estado de comision por colaborador.
- implementar logica anti-duplicado con respuesta determinista.
- conectar logs de seguridad.

Entrega:

- test manual API con casos ok/fallo.
- errores estandarizados y auditados.

## Fase 3 - CRM modulo Portal (4-6 dias)

- UI de dashboard, invites, usuarios, contenido, logs.
- flujos CRUD con validaciones.
- filtros por promocion y estado.
- panel de disputas de duplicados y atribucion.
- panel de visitas (solicitada, confirmada, realizada, no show).
- panel de colaboracion/comisiones.

Entrega:

- operativa completa desde CRM sin SQL manual.

## Fase 4 - Portal agentes/clientes (4-6 dias)

- login/activacion.
- listado de promociones autorizadas.
- detalle promocion con contenido y documentos.
- formulario de contacto ligado a `crm.leads`.
- timeline del lead visible para agente externo.
- modulo de solicitud de visita con estado.
- estado de comision visible por operacion.

Entrega:

- flujo end-to-end real con 1 promocion piloto.

## Fase 5 - Hardening y salida a produccion (3-4 dias)

- pentest basico interno (auth, endpoints, RLS).
- ajuste de rate limit, expiraciones y lockouts.
- monitorizacion y alertas operativas.
- plan de rollback y backup verificado.

Entrega:

- release checklist firmada y despliegue controlado.

## Criterios de aceptacion (Definition of Done)

1. Seguridad:
- no existe acceso a promociones no autorizadas.
- no se guarda ningun codigo en claro.
- accesos fallidos quedan auditados.

2. Operativa:
- CRM puede invitar, revocar, asignar y publicar contenido sin soporte tecnico.
- usuario portal puede activar cuenta y entrar sin friccion.
- el agente externo puede seguir el estado del lead sin depender de WhatsApp.
- duplicados quedan resueltos con regla clara y trazable.
- comision tiene estado visible y auditado.

3. Negocio:
- una promocion piloto funciona para agentes y clientes.
- leads/sobre-interacciones quedan registradas en CRM.

## Riesgos y mitigaciones

1. Riesgo: complejidad de permisos por tipo de usuario.
- mitigacion: matriz de permisos cerrada en Fase 0 y tests por rol.

2. Riesgo: abuso de codigos compartidos.
- mitigacion: invitacion individual + hash + expiracion + max intentos.

3. Riesgo: fuga de documentos privados.
- mitigacion: bucket privado + signed URLs + verificacion de membresia por servidor.

4. Riesgo: carga operativa alta del equipo comercial.
- mitigacion: UI CRM simple con plantillas por promocion e idioma.

5. Riesgo: friccion externa por falta de tracking.
- mitigacion: timeline minimo obligatorio para colaborador.

6. Riesgo: conflictos comerciales por leads duplicados.
- mitigacion: regla de atribucion + ventana de disputa + panel de resolucion.

## Orden recomendado de ejecucion real

1. Fase 0 y Fase 1 primero.
2. levantar API de invites/activacion.
3. construir CRM modulo Portal.
4. construir frontend portal autenticado.
5. hardening, QA y piloto.
6. abrir al resto de promociones.
