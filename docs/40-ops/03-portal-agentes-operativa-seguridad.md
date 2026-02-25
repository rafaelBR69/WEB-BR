# Operativa y seguridad del Portal de Agentes/Clientes

## Objetivo

Definir como operar el portal en el dia a dia desde CRM con control de seguridad y trazabilidad.

Documento complementario del plan:

- `docs/50-crm/06-portal-agentes-clientes-plan.md`

## Checklist diaria (operacion)

1. Revisar invitaciones pendientes de expirar (<48h).
2. Revisar intentos fallidos de activacion/login.
3. Revisar usuarios bloqueados y motivo.
4. Revisar publicaciones nuevas por promocion e idioma.
5. Revisar eventos anormales de descarga de documentos.
6. Revisar cola de disputas por duplicado de lead.
7. Revisar solicitudes de visita pendientes de confirmacion.
8. Revisar estados de comision desactualizados.

## Alta de un agente externo

1. Crear/validar `contact` y `agency` en CRM.
2. Crear invitacion portal con:
- email correcto
- promocion asignada
- rol (`portal_agent_admin` o `portal_agent_member`)
- expiracion (recomendado 72h)
3. Enviar invitacion.
4. Confirmar activacion en `portal_accounts`.
5. Verificar acceso real del usuario (prueba guiada).

## Alta de cliente comprador

1. Crear/validar `contact` y `client`.
2. Crear invitacion portal con rol `portal_client`.
3. Asignar promocion y permisos de visualizacion.
4. Confirmar activacion y primer login.
5. Registrar consentimiento de privacidad si aplica.

## Baja, bloqueo o revocacion

Casos:

- fin de colaboracion
- riesgo de seguridad
- cuenta comprometida

Pasos:

1. Revocar invitaciones activas del usuario.
2. Cambiar estado `portal_accounts.status='revoked'` o `blocked`.
3. Revocar membresias `portal_memberships.status='revoked'`.
4. Invalidar sesiones activas.
5. Registrar incidencia en logs.

## Publicacion de contenido por promocion

Secuencia recomendada:

1. Cargar contenido en borrador (`is_published=false`).
2. Revisar idioma y audiencia (`agent`, `client`, `both`).
3. Revisar documentos asociados y visibilidad.
4. Publicar y verificar desde una cuenta real de test.
5. Marcar version publicada y fecha.

## Protocolo anti-duplicados y atribucion

Regla base:

- el primer lead valido registrado con evidencia minima se atribuye al colaborador.

Ventana de disputa:

- configurable entre 24h y 72h.
- durante la ventana, estado `pending_review`.
- al cerrar ventana: `attributed` o `rejected_duplicate`.

Evidencia minima recomendada:

- nombre + email o telefono del comprador.
- proyecto objetivo.
- timestamp del envio.
- origen de envio (portal user id).

Resolucion de conflicto:

1. CRM revisa coincidencia contra leads existentes.
2. Si ya existe previo y verificable: `rejected_duplicate`.
3. Si no existe o no es concluyente: `manual_review`.
4. Registrar resolucion en timeline y log.

## SLA de actualizacion de estado de lead (externo)

Objetivo: evitar gestion por WhatsApp fuera del portal.

SLA recomendado:

- `recibido` inmediato al enviar lead.
- `aceptado` o `rechazado_duplicado` antes de 24h laborables.
- `visita_programada` al confirmar slot.
- `visita_realizada` o `no_show` el mismo dia de visita.
- `oferta`, `reservado_arras`, `cerrado`, `perdido` en cuanto cambie el CRM interno.

## Operativa de visitas

Modelo MVP recomendado:

- el colaborador propone 2 o 3 slots.
- equipo interno confirma 1 slot o pide nueva propuesta.

Reglas:

1. no bloquear agenda hasta confirmacion interna.
2. guardar siempre quien confirma y cuando.
3. marcar resultado de visita (`done` o `no_show`) para alimentar timeline.

## Operativa de comision visible

Estados minimos:

- `pending`, `approved`, `paid`, `cancelled`.

Regla de actualizacion:

1. al cerrar operacion se crea registro `pending`.
2. cuando direccion valida liquidacion pasa a `approved`.
3. al pago real pasa a `paid` con fecha y referencia.
4. cualquier excepcion debe quedar en `notes` auditables.

## Reglas de seguridad obligatorias

1. No compartir codigos por canales inseguros.
2. No reutilizar codigos entre usuarios.
3. Codigo siempre con expiracion y maximo de intentos.
4. Todo documento sensible en storage privado.
5. Descargas solo con signed URL corta.
6. Toda accion sensible debe quedar en logs.
7. CRM admin con MFA activo.

## Alarmas recomendadas

Generar alerta cuando:

- mismo email falla activacion >= 5 veces en 30 min.
- misma IP falla login >= 10 veces en 15 min.
- descarga masiva de documentos fuera de horario habitual.
- alta de usuario portal sin asignacion de promocion.
- intentos de acceso a promocion no autorizada.
- aumento de casos `rejected_duplicate` en un mismo colaborador.
- leads sin actualizacion de estado > 48h laborables.

## Plan de respuesta ante incidente

## Severidad alta (S1)

Ejemplos:

- acceso no autorizado confirmado
- fuga de documentos

Pasos:

1. bloquear cuentas afectadas.
2. revocar sesiones.
3. deshabilitar temporalmente endpoint comprometido si aplica.
4. preservar logs y evidencias.
5. abrir informe de incidente.
6. comunicar impacto y acciones.

## Severidad media (S2)

Ejemplos:

- intentos masivos fallidos sin acceso exitoso

Pasos:

1. bloquear IP/rango temporal.
2. elevar restricciones de rate limit.
3. forzar rotacion de codigos activos.
4. monitorizar 24h.

## Backup y rollback

Antes de cambios de schema portal:

1. backup de DB.
2. snapshot de politicas RLS.
3. validar scripts de rollback.

Si release falla:

1. rollback de migraciones no criticas.
2. despublicar contenido nuevo del portal.
3. reabrir acceso solo cuando QA de seguridad pase.

## KPI operativos semanales

1. tasa de activacion de invitaciones (%).
2. tiempo medio desde invitacion hasta primer login.
3. ratio login fallido/login total.
4. numero de revocaciones por seguridad.
5. numero de leads generados desde portal por promocion.
