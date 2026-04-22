# Turnstile para leads publicos

## Objetivo

Documentar como obtener, configurar y validar las claves de Cloudflare Turnstile usadas por los formularios publicos de leads.

Esta guia aplica a:

- `/{lang}/contact/`
- `/{lang}/sell-with-us/`
- `/{lang}/property/{slug}/`

## Variables de entorno

- `PUBLIC_TURNSTILE_SITE_KEY`
  - clave publica
  - se usa en frontend para renderizar el widget
- `TURNSTILE_SECRET_KEY`
  - clave privada
  - se usa en backend para validar el token en `POST /api/v1/leads`

## Donde sacar la site key y la secret key

1. Entrar en Cloudflare Dashboard.
2. Ir a `Turnstile`.
3. Pulsar `Add widget`.
4. Configurar:
   - nombre del widget
   - hostnames autorizados
   - modo recomendado: `Managed`
5. Guardar con `Create`.
6. Copiar:
   - `sitekey`
   - `secret key`

Uso en este proyecto:

- `PUBLIC_TURNSTILE_SITE_KEY` = `sitekey`
- `TURNSTILE_SECRET_KEY` = `secret key`

## Hostnames recomendados

Definir solo los hostnames reales donde se cargara el formulario.

Ejemplo recomendado:

- `www.blancareal.com`
- `blancareal.com`

Si existe un preview estable o subdominio operativo, añadirlo de forma explicita.

No usar comodines.

## Desarrollo local

La implementacion actual permite bypass controlado en `DEV` cuando faltan claves reales.

Si se quiere probar Turnstile de verdad en local, se puede usar Cloudflare de dos formas:

1. crear un widget real y autorizar `localhost`
2. usar claves de prueba oficiales

Claves de prueba oficiales:

- site key: `1x00000000000000000000AA`
- secret key: `1x0000000000000000000000000000000AA`

Estas claves sirven para pruebas y no deben quedarse en produccion.

## Comportamiento esperado por entorno

- `DEV` sin claves:
  - el backend hace bypass controlado
  - permite trabajar localmente sin bloquear formularios
- `DEV` con claves:
  - el widget se renderiza y el backend valida tokens
- preview/produccion:
  - Turnstile debe estar configurado
  - si falta o falla el token, el lead queda `blocked`

## Rotacion de secret key

Si hay sospecha de exposicion o simplemente rotacion preventiva:

1. abrir el widget en Cloudflare
2. ir a `Settings`
3. usar `Rotate Secret Key`
4. actualizar `TURNSTILE_SECRET_KEY` en entorno
5. redeployar

## Validacion manual minima

1. Abrir los tres formularios publicos.
2. Confirmar que el widget de Turnstile carga cuando hay `PUBLIC_TURNSTILE_SITE_KEY`.
3. Enviar un lead humano valido y comprobar:
   - respuesta `201`
   - insercion en `crm.leads`
   - log `lead_submitted`
4. Forzar un caso invalido y comprobar:
   - respuesta bloqueada
   - log `blocked`

## Notas del proyecto

- La `site key` es publica y puede estar en frontend.
- La `secret key` nunca debe quedar en cliente, repositorio ni capturas compartidas.
- El endpoint afectado es `apps/web/src/pages/api/v1/leads.ts`.
- La clasificacion funcional asociada es `blocked`, `junk` y `new`.

## Referencias

- `docs/40-ops/2026-04-22-acta-anti-spam-leads-publicos.md`
- `apps/web/src/pages/api/v1/leads.ts`
- `packages/shared/src/leads/publicLeadSpamGuard.ts`
