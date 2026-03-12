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

## Variables de entorno

En `.env`:

- `PUBLIC_MAPBOX_TOKEN`
- `PUBLIC_MAPBOX_STYLE`
- `RESEND_API_KEY` (opcional, para emails automaticos del portal)
- `PORTAL_EMAIL_FROM` (opcional, remitente para emails del portal)
- `PORTAL_EMAIL_REPLY_TO` (opcional)
- `RESEND_PORTAL_APPROVAL_TEMPLATE_ID` (opcional, plantilla concreta de Resend para aprobacion portal)

## Despliegue en Vercel

Para desplegar solo la web publica desde este mismo repo:

1. Crea el proyecto en Vercel apuntando a la raiz del repo.
2. Deja el comando de build en `npm run build`.
3. Anade la variable de entorno `APP_DEPLOY_SURFACE=web`.

Con `APP_DEPLOY_SURFACE=web`:

- la web publica sigue funcionando normal
- `/crm/*` queda bloqueado
- `/api/v1/crm/*` y APIs internas generales quedan bloqueadas
- se mantienen disponibles `POST /api/v1/leads`, `GET /api/v1/health` y `/api/v1/portal/*`

La config de Astro cambia automaticamente al adapter de Vercel cuando el build corre dentro de Vercel.

## Documentacion completa

Ir a `docs/README.md`.

Ruta recomendada para onboarding:

1. `docs/00-start-here/01-setup-local.md`
2. `docs/00-start-here/02-first-60-minutes.md`
3. `docs/10-architecture/01-repo-map.md`
4. `docs/20-content-models/01-properties.md`
5. `docs/30-playbooks/01-add-new-project.md`
