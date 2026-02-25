# Portal API - Fase 2 (backend)

## Estado

Fase 2 backend implementada en `src/pages/api/v1/portal/*` con build OK.

## Endpoints implementados

## Invitaciones y activacion

- `GET /api/v1/portal/invites`
  - Lista invitaciones por `organization_id` (filtros: `status`, `project_property_id`, `email`).
- `POST /api/v1/portal/invites`
  - Crea invitacion.
  - Genera `one_time_code` y guarda `code_hash` (nunca codigo plano en BD).
- `POST /api/v1/portal/invites/{id}/revoke`
  - Revoca invitacion.
- `POST /api/v1/portal/auth/validate-code`
  - Valida codigo de invitacion.
  - Incrementa intentos y bloquea al superar maximo.
- `POST /api/v1/portal/auth/activate`
  - Activa cuenta portal con email/password/codigo.
  - Crea `auth.users`, `portal_accounts`, membresia por proyecto (si aplica) y consume invitacion.

## Cuenta portal y proyectos

- `GET /api/v1/portal/me`
  - Devuelve cuenta portal + memberships + proyectos asociados.
- `GET /api/v1/portal/projects`
  - Lista promociones permitidas por `portal_memberships`.
- `GET /api/v1/portal/projects/{id}/content`
  - Devuelve contenido publicado filtrado por audiencia (`agent/client/both`) segun rol.
- `GET /api/v1/portal/projects/{id}/documents`
  - Devuelve documentos portal publicados y visibles por rol.

## Leads, tracking y visitas

- `POST /api/v1/portal/projects/{id}/leads`
  - Crea lead desde portal.
  - Crea registro en `portal_lead_tracking`.
  - Aplica deteccion basica de duplicados por contacto+proyecto.
- `GET /api/v1/portal/leads`
  - Lista leads del colaborador autenticado (via `portal_account_id`) con tracking.
- `GET /api/v1/portal/leads/{id}`
  - Detalle de lead + tracking + visitas + comisiones.
- `POST /api/v1/portal/leads/{id}/visit-requests`
  - Crea solicitud de visita (2-3 slots para `proposal_slots`).
- `GET /api/v1/portal/visit-requests/{id}`
  - Consulta solicitud de visita.
- `PATCH /api/v1/portal/visit-requests/{id}`
  - Actualiza estado (`confirmed`, `declined`, `done`, `no_show`, etc).

## Comisiones y auditoria

- `GET /api/v1/portal/commissions`
  - Lista estado de colaboracion/comisiones por cuenta portal.
- `GET /api/v1/portal/access-logs`
  - Lista logs de seguridad y actividad portal.

## Seguridad aplicada en API

- Validaciones por `organization_id`, `portal_account_id` y membresia activa por proyecto.
- Verificacion de codigo por hash (`sha256:salt:digest`).
- Control de intentos y bloqueo de invitaciones.
- Registro de eventos en `crm.portal_access_logs`:
  - `invite_sent`, `invite_revoked`, `signup_ok`, `signup_fail`, `code_fail`, `blocked`,
  - `lead_submitted`, `duplicate_detected`, `visit_requested`, `visit_confirmed`.

## Nota de arquitectura (importante)

En la implementacion actual, la API usa `SUPABASE_SERVICE_ROLE_KEY` (server client).
Eso permite operar aunque no haya auth JWT de usuario final todavia.

Siguiente fase recomendada:

1. Integrar sesiones/autenticacion real del portal en frontend.
2. Resolver `portal_account_id` desde `auth.uid()` en servidor (no por query/body).
3. Endurecer permisos para que ninguna ruta dependa de ids enviados por cliente.
