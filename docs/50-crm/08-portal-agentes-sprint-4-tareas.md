# Sprint 4 - Backlog de cierre Portal Agentes

## Objetivo

Convertir el estado actual del portal en un MVP publicable y operable desde CRM, con seguridad real de autenticacion, permisos por rol y gestion documental segura.

## Alcance de este backlog

- Incluye pendientes `Bloqueante` e `Importante` reportados.
- Incluye subtareas tecnicas y funcionales para ejecutar.
- Incluye criterio de cierre por tarea.
- Marca trabajo ya hecho para no duplicar esfuerzo.

## Prioridades

- `P0` Bloqueante: no se publica Sprint 4 sin esto.
- `P1` Importante: debe entrar en Sprint 4 o primer hotfix inmediato.

---

## T01 (P0) Publicar acceso al portal en navegacion publica

Estado actual: menu apunta a `/agents/` en lugar de `/portal/`.

Subtareas:
- [ ] Cambiar enlaces de navegacion global a `/portal/` (ES/EN si aplica).
- [ ] Revisar enlaces duplicados en layouts y menus movil/desktop.
- [ ] Validar que no quedan rutas antiguas (`/agents/`) visibles para usuario final.
- [ ] Verificar redireccion o compatibilidad temporal de `/agents/` (301 o fallback).

Criterio de cierre:
- Desde header y menu movil se entra a `/portal/` sin rutas rotas.

Archivos base:
- `src/layouts/BaseLayout.astro`

Dependencias:
- Ninguna.

---

## T02 (P0) Crear modulo visual CRM del portal (`/crm/portal/*`)

Estado actual: plan definido, vistas CRM no publicadas.

Subtareas:
- [ ] Crear dashboard `src/pages/crm/portal/index.astro`.
- [ ] Crear pantalla de invites `src/pages/crm/portal/invites.astro`.
- [ ] Crear pantalla de usuarios/membresias `src/pages/crm/portal/users.astro`.
- [ ] Crear pantalla de contenido `src/pages/crm/portal/content.astro`.
- [ ] Crear pantalla de logs `src/pages/crm/portal/logs.astro`.
- [ ] Integrar navegacion en `CrmLayout.astro`.
- [ ] Definir estados UI: loading, empty, error, success.
- [ ] Conectar cada pantalla a APIs reales de portal.

Criterio de cierre:
- Modulo CRM portal accesible y navegable de punta a punta para usuario interno.

Archivos base:
- `src/layouts/CrmLayout.astro`
- `docs/50-crm/06-portal-agentes-clientes-plan.md`

Dependencias:
- T06, T07, T08 para operativa completa.

---

## T03 (P0) Login real de portal (email/password)

Estado actual: sesion temporal manual con `organization_id` + `portal_account_id` via storage.

Subtareas:
- [ ] Reemplazar login temporal por flujo real con Supabase Auth (email/password).
- [ ] Eliminar necesidad de cargar `portal_account_id` manual en frontend.
- [ ] Guardar sesion mediante cookie/token oficial (sin identificadores manuales).
- [ ] Implementar logout limpio (token + cache local).
- [ ] Manejar errores de auth: credenciales invalidas, usuario bloqueado, invite no activada.
- [ ] Cubrir flujo de activacion de cuenta y primer acceso.

Criterio de cierre:
- Un usuario portal puede iniciar/cerrar sesion sin tocar storage manual.

Archivos base:
- `src/pages/portal/login.astro`
- `src/pages/portal/shared.js`
- `src/pages/portal/login.js`

Dependencias:
- T04 y T05.

---

## T04 (P0) Resolver identidad en servidor con `auth.uid()`

Estado actual: APIs portal exigen `portal_account_id` en query/body.

Subtareas:
- [ ] Cambiar resolucion de identidad en endpoints portal para tomar usuario autenticado del JWT.
- [ ] Eliminar `portal_account_id` de query/body en contratos API portal.
- [ ] Validar `organization_id` y membresias desde identidad servidor (no desde cliente).
- [ ] Ajustar frontend portal al nuevo contrato API.
- [ ] Actualizar tests/fixtures de API para nuevo flujo.

Criterio de cierre:
- Ningun endpoint portal depende de `portal_account_id` enviado por frontend.

Archivos base:
- `src/pages/api/v1/portal/me.ts`
- `src/pages/api/v1/portal/projects.ts`
- `src/pages/api/v1/portal/projects/[id]/leads.ts`
- `docs/50-crm/07-portal-api-fase-2.md`

Dependencias:
- T03.

---

## T05 (P0) Quitar `service_role` como modelo principal de auth portal

Estado actual: server client portal usa `SUPABASE_SERVICE_ROLE_KEY`.

Subtareas:
- [ ] Separar clientes Supabase: anon/authenticated para requests de usuario y service_role solo para tareas admin controladas.
- [ ] Mover consultas portal de lectura/escritura normal al contexto del usuario autenticado.
- [ ] Mantener `service_role` solo en operaciones internas justificadas (si no hay alternativa).
- [ ] Revisar politicas RLS para que soporte flujo sin bypass de permisos.
- [ ] Auditoria de variables de entorno y consumo en runtime.

Criterio de cierre:
- El flujo normal de portal funciona sin depender de `SUPABASE_SERVICE_ROLE_KEY`.

Archivos base:
- `src/lib/supabaseServer.ts`
- `docs/50-crm/07-portal-api-fase-2.md`

Dependencias:
- T04.

---

## T06 (P0) Backoffice CRM para invites y membresias multi-promocion

Estado actual: API existe, falta capa UI CRM operable por negocio.

Subtareas:
- [ ] UI para crear invite por email + rol + promocion(es).
- [ ] UI para revocar invite y ver estado (pending/accepted/expired/revoked).
- [ ] UI para asignar/quitar membresias a multiples promociones por usuario.
- [ ] Validaciones de negocio (sin duplicados, estados invalidos).
- [ ] Tabla/listado con filtros por promocion, rol y estado.
- [ ] Confirmaciones UX para acciones destructivas (revocar/quitar acceso).

Criterio de cierre:
- Equipo CRM puede gestionar alta/baja de acceso portal sin soporte tecnico.

Archivos base:
- `src/pages/api/v1/portal/invites.ts`
- `src/pages/api/v1/portal/auth/activate.ts`
- `docs/50-crm/06-portal-agentes-clientes-plan.md`

Dependencias:
- T02.

---

## T07 (P0) Backoffice CRM para contenido portal por idioma/audiencia

Estado actual: `/projects/{id}/content` en portal es solo lectura.

Subtareas:
- [ ] Publicar CRUD CRM para `portal_content_blocks` (crear/editar/publicar/despublicar/eliminar).
- [ ] Soporte de idioma (`es`, `en`, etc.) por bloque.
- [ ] Soporte de audiencia (`agent`, `client`, ambos) por bloque.
- [ ] Versionado basico (updated_at, updated_by) y vista previa.
- [ ] Integrar consumo en frontend portal con fallback por idioma.

Criterio de cierre:
- Contenido portal editable desde CRM por idioma y audiencia sin tocar SQL/manual.

Archivos base:
- `src/pages/api/v1/portal/projects/[id]/content.ts` (portal read)
- `src/pages/api/v1/crm/portal/projects/[id]/content.ts` (nuevo CRUD recomendado)

Dependencias:
- T02.

---

## T08 (P0) Backoffice CRM para documentos portal (publicacion y visibilidad)

Estado actual: portal solo tiene GET de documentos; endpoint CRM generico de documentos sigue mock.

Subtareas:
- [ ] Definir API CRM real para documentos portal (alta, update metadatos, publicar, ocultar, borrar).
- [ ] Implementar reglas de visibilidad por rol/audiencia y promocion.
- [ ] Soportar categorias/tipos de documento (Agency Kit vs Client Kit).
- [ ] UI CRM para subir, editar metadatos y cambiar estado de publicacion.
- [ ] Eliminar/migrar comportamiento mock del endpoint generico.

Criterio de cierre:
- Documentos portal se gestionan desde CRM con control de visibilidad real.

Archivos base:
- `src/pages/api/v1/portal/projects/[id]/documents.ts`
- `src/pages/api/v1/crm/documents.ts` (mock actual)

Dependencias:
- T02.

---

## T09 (P0) Descarga segura de documentos portal (bucket privado + signed URL corta)

Estado actual: API devuelve `storage_bucket/storage_path`; no signed URL efimera.

Subtareas:
- [ ] Migrar documentos sensibles a bucket privado.
- [ ] Crear endpoint de descarga segura que emita signed URL de corta duracion.
- [ ] Validar permiso en servidor antes de firmar URL (rol, organizacion, promocion, audiencia).
- [ ] Invalidar links expuestos directos a `storage_path`.
- [ ] Registrar eventos de acceso/descarga en log de seguridad.
- [ ] Ajustar frontend portal para consumir solo URL firmadas.

Criterio de cierre:
- Ningun documento sensible se descarga por URL publica permanente.

Archivos base:
- `src/pages/api/v1/portal/projects/[id]/documents.ts`
- `src/pages/portal/project.js`
- `src/lib/crmClientDocumentsStorage.ts`
- `docs/50-crm/06-portal-agentes-clientes-plan.md`

Dependencias:
- T08.

---

## T10 (P1) Flujo CRM de timeline comercial completo

Estado actual: se crea timeline inicial al alta de lead; falta panel CRM para mover estados operativos.

Subtareas:
- [ ] Definir maquina de estados permitidos y transiciones validas.
- [ ] UI CRM para avanzar/retroceder estado de lead con historial.
- [ ] Registro obligatorio de actor, fecha y nota por cambio de estado.
- [ ] Vista timeline para externo (solo lectura) y para interno (operable).
- [ ] Alertas basicas en cambios criticos (ej. rechazado, cerrado, comision_pagada).

Criterio de cierre:
- Equipo interno actualiza timeline completo desde CRM con trazabilidad.

Archivos base:
- `src/pages/api/v1/portal/projects/[id]/leads.ts`
- `docs/40-ops/03-portal-agentes-operativa-seguridad.md`

Dependencias:
- T02.

---

## T11 (P1) Flujo CRM de comisiones y visitas

Estado actual: portal lee comisiones/visitas; falta gestion diaria CRM (confirmar/rechazar/actualizar comision).

Subtareas:
- [ ] Panel CRM de solicitudes de visita (pendiente/confirmada/rechazada/reprogramada).
- [ ] Acciones de confirmacion/rechazo con motivo y logging.
- [ ] Panel CRM de comisiones por lead/deal (pendiente/aprobada/pagada).
- [ ] Acciones para actualizar importe/estado/comentario de comision.
- [ ] Exponer resumen claro al portal externo sincronizado con CRM.

Criterio de cierre:
- Operativa de visitas y comisiones se puede hacer 100% desde CRM.

Archivos base:
- `src/pages/api/v1/portal/commissions.ts`
- `src/pages/api/v1/portal/visit-requests/[id].ts`

Dependencias:
- T02.

---

## T12 (P1) Restricciones de acceso y auditoria por rol interno

Estado actual: logs/access endpoint exige `organization_id`, pero no rol interno fuerte (`admin/legal`).

Subtareas:
- [ ] Definir matriz de permisos para logs y acciones sensibles.
- [ ] Restringir endpoints de auditoria a roles internos autorizados.
- [ ] Guardar actor interno y razon en acciones sensibles.
- [ ] Asegurar que usuarios portal externos no pueden consultar logs internos.
- [ ] Añadir pruebas de autorizacion por rol.

Criterio de cierre:
- Auditoria y endpoints sensibles bloqueados por rol interno real.

Archivos base:
- `src/pages/api/v1/portal/access-logs.ts`
- `docs/50-crm/06-portal-agentes-clientes-plan.md`

Dependencias:
- T04, T05.

---

## Trabajo ya hecho (no reabrir como desarrollo)

- [x] Subida multimedia de propiedades desde CRM.
- [x] Limpieza de huerfanos de media de propiedades.

Referencias:
- `src/pages/crm/propiedad/[id].astro`
- `src/lib/crm/properties.js`
- `src/pages/api/v1/crm/media/upload.ts`
- `scripts/cleanup-crm-property-storage-orphans.mjs`

Nota:
- Documentos de clientes/portal siguen con pendiente de endurecimiento de seguridad (cubierto en T08 y T09).

---

## Orden recomendado de ejecucion

1. `T01` + `T02` (acceso y estructura base CRM).
2. `T03` -> `T04` -> `T05` (auth y seguridad servidor).
3. `T06` + `T07` + `T08` (operativa CRM portal).
4. `T09` (seguridad documental final).
5. `T10` + `T11` + `T12` (operativa avanzada y auditoria).

## Definicion de Done global Sprint 4

- [ ] Login portal real en produccion sin sesion manual.
- [ ] Identidad servidor basada en `auth.uid()` y RLS efectiva.
- [ ] CRM portal operativo para invites, membresias, contenido y documentos.
- [ ] Descarga documental segura con bucket privado y signed URLs cortas.
- [ ] Flujo comercial (timeline, visitas, comisiones) gestionable en CRM.
- [ ] Auditoria y permisos por rol interno aplicados.
