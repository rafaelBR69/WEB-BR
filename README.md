# WEB-BR

Web inmobiliaria multidioma (Astro) con:

- listado de propiedades
- detalle de propiedad/proyecto
- mapa interactivo con Mapbox
- pagina de proyectos
- pagina de posts
- pagina de equipo

## Start rapido

1. `npm install`
2. `npm run dev`
3. abrir `http://localhost:4321`

### Superficies locales

- `npm run dev:web` para probar solo la superficie web/portal
- `npm run dev:crm:surface` para probar solo la superficie CRM
- `cd apps/web && npm run dev` para usar el entrypoint dedicado de web
- `cd apps/crm && npm run dev` para usar el entrypoint dedicado de CRM

## Variables de entorno

En `.env`:

- `PUBLIC_MAPBOX_TOKEN`
- `PUBLIC_MAPBOX_STYLE`
- `RESEND_API_KEY` (opcional, para emails automaticos del portal)
- `PORTAL_EMAIL_FROM` (opcional, remitente para emails del portal)
- `PORTAL_EMAIL_REPLY_TO` (opcional)
- `RESEND_PORTAL_APPROVAL_TEMPLATE_ID` (opcional, plantilla concreta de Resend para aprobacion portal)

## Despliegue en Vercel

Este repo soporta dos superficies compatibles durante la separacion gradual:

- `APP_DEPLOY_SURFACE=web`
- `APP_DEPLOY_SURFACE=crm`

### Web publica

Para desplegar solo la web publica desde este mismo repo:

1. Crea el proyecto en Vercel apuntando a la raiz del repo.
2. Usa el comando de build `npm run build:production:web`.
3. Anade la variable de entorno `APP_DEPLOY_SURFACE=web`.

Con `APP_DEPLOY_SURFACE=web`:

- la web publica sigue funcionando normal
- `/crm/*` queda bloqueado
- `/api/v1/crm/*` y APIs internas generales quedan bloqueadas
- se mantienen disponibles `POST /api/v1/leads`, `GET /api/v1/health` y `/api/v1/portal/*`

La config de Astro cambia automaticamente al adapter de Vercel cuando el build corre dentro de Vercel.

### CRM

Para desplegar solo el CRM desde este mismo repo:

1. Crea un segundo proyecto en Vercel apuntando tambien a la raiz del repo.
2. Usa el comando de build `npm run build`.
3. Anade la variable `APP_DEPLOY_SURFACE=crm`.

Con `APP_DEPLOY_SURFACE=crm`:

- `/crm/*` sigue disponible
- `/api/v1/crm/*` sigue disponible
- `/` redirige a `/crm/`
- la web publica y el portal quedan fuera de ese despliegue

## Shared layer

`packages/shared/` ya es la fuente canonica del negocio compartido durante la separacion:

- acceso a Supabase
- helpers JSON/API
- dominio de portal
- auth y access CRM
- propiedades, clientes, leads y agencies
- storage de propiedades y documentos

`src/utils/*` sigue existiendo como capa de compatibilidad mientras la raiz del repo mantiene wrappers y rutas legacy. El codigo nuevo debe ir a:

- `packages/shared/src/*` para logica compartida
- `apps/web/src/*` para web y portal
- `apps/crm/src/*` para CRM

Alias disponibles:

- `@/*` -> `src/*`
- `@shared/*` -> `packages/shared/src/*`

## Entry points dedicados

Ya existen configuraciones Astro separadas para:

- `apps/web/astro.config.mjs`
- `apps/crm/astro.config.mjs`

Ambas siguen reutilizando el codigo fuente actual del repo durante la migracion, pero ya generan salida independiente:

- `dist/web`
- `dist/crm`

Nota:

- `npm run build:web` y `npm run build:crm` pueden ejecutarse por separado sin problema
- para despliegue de web publica usa `npm run build:production:web`
- si lanzas `npm run build` a la vez que otro build de superficie puede aparecer un `EPERM` sobre `dist/web`; ejecutado en solitario funciona correctamente

## Documentacion completa

Ir a `docs/README.md`.

Ruta recomendada para onboarding:

1. `docs/00-start-here/01-setup-local.md`
2. `docs/00-start-here/02-first-60-minutes.md`
3. `docs/10-architecture/01-repo-map.md`
4. `docs/20-content-models/01-properties.md`
5. `docs/30-playbooks/01-add-new-project.md`
