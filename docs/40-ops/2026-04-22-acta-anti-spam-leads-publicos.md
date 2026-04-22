# Acta de definicion anti-spam de leads publicos

- Fecha: 2026-04-22
- Autor: Rafael Manuel Borrego Reyes

## Contexto

Se detecto un problema real en los formularios publicos de leads de la web: no solo habia riesgo de bot clasico, sino tambien entradas con contenido inventado o de baja credibilidad, como nombres artificiales, mensajes sin sentido y datos de contacto de baja calidad.

La situacion revisada el 2026-04-22 mostraba dos necesidades:

1. frenar abuso tecnico en el endpoint publico de leads
2. separar el contenido sospechoso que no debe llegar al flujo comercial normal

## Decisiones cerradas el 2026-04-22

- Se aprueba incorporar Cloudflare Turnstile en la v1 para los formularios publicos.
- Se aprueba una clasificacion cerrada en tres salidas:
  - `blocked`: abuso tecnico, sin creacion de lead comercial ni email
  - `junk`: lead sospechoso persistido en CRM para auditoria, sin email
  - `new`: lead valido con flujo normal
- Se aprueba mantener esta v1 sin panel nuevo de revision; `junk` se revisara desde CRM o Supabase si hace falta.
- Se aprueba que las notificaciones por email solo salgan para leads con estado `new`.

## Alcance exacto de la v1

- Proteger `POST /api/v1/leads` con:
  - validacion de shape y tamanos
  - honeypot
  - tiempo minimo desde render del formulario
  - verificacion server-side de Turnstile
  - rate limit por IP, email y telefono
  - heuristica acumulativa de texto basura
- Ampliar los tres formularios publicos para enviar:
  - `website_form`
  - `hp_field`
  - `form_rendered_at`
  - `turnstile_token`
- Persistir en `crm.leads` los leads publicos `new` y `junk`.
- Registrar intentos `blocked` y envios aceptados en `crm.portal_access_logs`.

## Nota expresa de veracidad

Este documento deja constancia de que, en fecha 2026-04-22, quedo realizado el analisis, la definicion funcional y tecnica, y la aprobacion de la solucion anti-spam para leads publicos.

La implementacion de codigo, las pruebas finales y el despliegue a entorno productivo se consideran fase posterior a esta acta y no forman parte de la afirmacion documental de "hecho" correspondiente al 2026-04-22.

## Siguiente paso operativo

- Aplicar los cambios en endpoint y formularios publicos.
- Configurar `PUBLIC_TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY`.
- Validar manualmente los tres formularios en navegador.
- Verificar en Supabase la persistencia correcta de `new`, `junk` y los logs `blocked`.
- Guia operativa asociada: `docs/40-ops/04-turnstile-leads-publicos.md`.
