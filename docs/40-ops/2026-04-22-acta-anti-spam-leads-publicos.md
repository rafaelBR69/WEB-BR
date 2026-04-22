# Acta de trabajo anti-spam de leads publicos

- Fecha: 2026-04-22
- Autor: Rafael Manuel Borrego Reyes

## Objeto

Dejar constancia documental del trabajo realizado el 2026-04-22 sobre:

1. la proteccion anti-spam de los formularios publicos de leads
2. la incorporacion de Cloudflare Turnstile
3. la configuracion operativa necesaria para despliegue
4. la incidencia tecnica detectada durante el build de la web
5. la recuperacion del funcionamiento normal de la web

## Contexto inicial

Se detecto un problema real en los formularios publicos de leads de la web: no solo habia riesgo de bot clasico, sino tambien entradas con contenido inventado o de baja credibilidad, como nombres artificiales, mensajes sin sentido y datos de contacto de baja calidad.

La necesidad tecnica y funcional quedo acotada en dos frentes:

1. frenar abuso tecnico en el endpoint publico de leads
2. separar del flujo comercial normal los leads sospechosos, sin perder trazabilidad

## Decisiones cerradas y aplicadas el 2026-04-22

- Se adopta Cloudflare Turnstile como captcha de la v1 para formularios publicos.
- Se mantiene una clasificacion cerrada en tres salidas:
  - `blocked`: abuso tecnico, sin lead comercial ni email
  - `junk`: lead sospechoso persistido para auditoria, sin email
  - `new`: lead valido con flujo normal
- Se mantiene esta v1 sin panel nuevo de revision; `junk` se revisa desde CRM o Supabase cuando sea necesario.
- Las notificaciones por email quedan restringidas a leads con estado `new`.

## Implementacion realizada

Se deja implementada la v1 anti-spam sobre el flujo publico de leads.

- Endpoint afectado:
  - `apps/web/src/pages/api/v1/leads.ts`
- Modulos nuevos:
  - `packages/shared/src/leads/publicLeadSpamGuard.ts`
  - `packages/shared/src/leads/publicLeadRateLimit.ts`
- Formularios actualizados:
  - `apps/web/src/pages/[lang]/contact/index.astro`
  - `apps/web/src/pages/[lang]/sell-with-us/index.astro`
  - `apps/web/src/pages/[lang]/property/[slug].astro`

La logica aplicada queda asi:

- validacion estricta de payload publico
- obtencion de IP y `user_agent`
- bloqueo por honeypot relleno
- bloqueo por envio demasiado rapido desde `form_rendered_at`
- verificacion server-side de Turnstile
- rate limit por IP, email y telefono
- heuristica acumulativa de texto basura para clasificar `junk`

## Cambios funcionales ejecutados

- Los formularios publicos envian:
  - `website_form`
  - `hp_field`
  - `form_rendered_at`
  - `turnstile_token`
- Los leads `new` y `junk` se persisten en `crm.leads`.
- Los leads `junk` se guardan con `status='junk'` y `discarded_reason='spam_guard_gibberish'`.
- Los eventos tecnicos y de envio se registran en `crm.portal_access_logs`.
- `sendGenericLeadNotificationEmail` y `sendPropertyLeadNotificationEmail` solo se ejecutan para `new`.

## Configuracion operativa de Turnstile

Se deja documentado y aclarado durante la operativa del dia:

- Variables necesarias:
  - `PUBLIC_TURNSTILE_SITE_KEY`
  - `TURNSTILE_SECRET_KEY`
- Widget recomendado:
  - modo `Managed`
  - hostnames `blancareal.com` y `www.blancareal.com`
- Guia asociada:
  - `docs/40-ops/04-turnstile-leads-publicos.md`

## Aclaracion operativa del VPS

Durante la revision del despliegue se detecto que el fichero operativo real del servicio no era `/var/www/web-br/app.env`, sino:

- `/etc/blancareal/app.env`

La comprobacion se realizo revisando la unidad del servicio:

- `blancareal-web.service`
- `EnvironmentFile=-/etc/blancareal/app.env`

Tambien se confirmo que el servicio web escucha en:

- `127.0.0.1:3001`

Por tanto, una respuesta `502` no estaba relacionada con el puerto `22` de SSH ni con IONOS, sino con un problema interno de build o de proceso en el VPS.

## Incidencia tecnica detectada el 2026-04-22

Durante el build en el VPS la web entro en error `502`.

La causa real detectada fue:

- fallo de `npm run build:web`
- error de `vite:json`
- archivo invalido: `src/data/properties/A044944.json`

La revision posterior confirmo que:

- `src/data/properties/A044944.json` estaba a `0` bytes
- el error exacto era `Unexpected end of JSON input`

Ese archivo vacio hacia fallar el build y provocaba la caida del proceso servido por `blancareal-web`, dejando a Nginx sin upstream valido.

## Correccion aplicada a la incidencia

Se reconstruyo por completo `src/data/properties/A044944.json` tomando como referencia la estructura de las fichas hermanas de `Alcantara del Mar`.

Se incorporo:

- estructura JSON valida completa
- contenido comercial del local facilitado por el usuario
- precio desde `324731 EUR`
- superficie `61.27 m2`
- tipo `local`
- imagen de portada y galeria con URLs de Supabase facilitadas por el usuario

## Verificaciones realizadas

Se deja constancia de las comprobaciones tecnicas hechas durante el dia:

- `A044944.json` vuelve a parsear correctamente
- `npm run build:web` vuelve a completar sin error en entorno local
- la causa del `502` queda acotada al JSON vacio y no al puerto `22`
- el usuario confirma al cierre de la operativa que la web vuelve a funcionar

## Estado final del trabajo

A fecha 2026-04-22 queda registrado como realizado:

- analisis, definicion y aprobacion de la solucion anti-spam
- implementacion de la v1 anti-spam en endpoint y formularios
- documentacion operativa de Turnstile
- identificacion del fichero real de entorno del VPS
- diagnostico del `502`
- reconstruccion del JSON roto `A044944.json`
- recuperacion del estado operativo de la web

## Nota de veracidad

Este documento refleja el trabajo realmente ejecutado el 2026-04-22.

No se documenta como realizado nada distinto de lo ejecutado durante la sesion:

- la implementacion anti-spam quedo aplicada en el codigo
- la configuracion operativa de Turnstile quedo aclarada y documentada
- la incidencia del build por JSON vacio fue identificada y corregida
- el restablecimiento final de la web queda consignado conforme a la confirmacion operativa del usuario
