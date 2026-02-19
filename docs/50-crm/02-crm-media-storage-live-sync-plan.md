# CRM media + Storage + live sync plan

## Objetivo

Tener un flujo completo y estable para media de propiedades:

1. Subir imagenes (incluyendo `png`) desde CRM.
2. Guardar archivo en Supabase Storage en una carpeta controlada.
3. Guardar referencia de ese archivo en `crm.properties.media`.
4. Reflejar el cambio en la web publica de forma inmediata (sin esperar despliegues).

## Diagnostico actual

- CRM media actual:
  - `src/pages/api/v1/properties/[id]/media.ts` solo acepta URL en JSON.
  - No hay subida binaria de archivos a Storage desde CRM.
- Web publica actual:
  - consume propiedades desde `src/data/properties/*.json` (datos locales).
  - mientras siga asi, no puede reflejar cambios de Supabase "al instante".

## Fase 0 - decisiones de arquitectura (bloqueante)

1. Bucket de Storage:
  - recomendado: `properties` (publico).
2. Estructura de carpetas:
  - `org/{organization_id}/property/{property_id}/{category}/{yyyy}/{mm}/{timestamp}_{slug}.{ext}`
3. Limites:
  - tipos permitidos: `image/png`, `image/jpeg`, `image/webp` (fase 1).
  - tamano maximo por archivo: p.ej. `10MB`.
4. Estrategia de cache imagen:
  - versionado por `updated_at` en URL (`?v=`) para invalidacion visual.

## Fase 1 - backend upload a Supabase Storage

### Trabajo

1. Crear endpoint nuevo:
  - `POST /api/v1/properties/[id]/media/upload`
  - body: `multipart/form-data`
  - campos: `organization_id`, `category`, `label`, `alt_es`, `set_as_cover`, `file`
2. Validaciones:
  - propiedad existe y pertenece a la organizacion.
  - categoria valida.
  - mime/ext permitidos.
  - tamano maximo.
3. Subida:
  - guardar en Storage (`storage.from(bucket).upload(path, file)`).
4. Persistencia:
  - construir URL publica.
  - insertar item en `media.gallery[category]` y opcionalmente portada.
  - actualizar `crm.properties.media`.
5. Respuesta API:
  - propiedad actualizada + `storage_bucket` + `storage_path` + `public_url`.

### Criterios de aceptacion

- desde API, subir un `png` devuelve `200` y se ve en Supabase Storage.
- el item aparece en `media.gallery` de la propiedad.
- si `set_as_cover=true`, actualiza portada.

## Fase 2 - CRM UI para subir archivo real

### Trabajo

1. `public/crm/properties.js`:
  - en form de media, agregar input file (`accept=".png,.jpg,.jpeg,.webp"`).
  - si hay archivo: usar endpoint `.../media/upload` con `FormData`.
  - si no hay archivo: mantener flujo actual de URL manual (`.../media`).
2. UX:
  - estado "subiendo...".
  - toasts de exito/error (ya existe base de toasts).
  - refresco de panel media al terminar.

### Criterios de aceptacion

- usuario sube PNG desde CRM y lo ve al instante en portada/galeria del CRM.
- sigue funcionando el modo URL manual sin regresiones.

## Fase 3 - web publica en vivo desde Supabase (clave para "al instante")

### Trabajo

1. Crear loader server-side de propiedades desde `crm.properties`:
  - p.ej. `src/utils/publicPropertiesSource.ts`.
  - fallback a JSON local solo si Supabase no disponible.
2. Mapear row CRM -> modelo usado por web publica:
  - campos minimos: `id`, `slugs`, `status`, `price`, `currency`, `location`,
    `property`, `features`, `media`, `translations`, `seo`, `listing_type`, `parent_id`.
3. Sustituir import estatico en rutas clave:
  - `src/pages/[lang]/properties/index.astro`
  - `src/pages/[lang]/property/[slug].astro`
  - `src/pages/[lang]/projects/index.astro`
4. Cache busting de imagen:
  - anexar `?v={updated_at}` a cover/gallery renderizadas.

### Criterios de aceptacion

- tras subir imagen en CRM, al recargar la pagina publica ya aparece el cambio.
- no hace falta migrar JSON manual ni redeploy para ver cambios.

## Fase 4 - limpieza y robustez del ciclo de vida

### Trabajo

1. Borrado coherente:
  - cuando se elimina media en CRM, opcion de borrar tambien objeto de Storage.
2. Orfanos:
  - script de auditoria para detectar archivos no referenciados en DB.
3. Observabilidad:
  - logs de `storage_path`, errores de subida, errores de DB.

### Criterios de aceptacion

- no quedan archivos huerfanos en volumen normal.
- errores de subida tienen mensajes claros para negocio.

## Fase 5 (opcional) - realtime sin recargar pagina

Si se quiere "instantaneo" incluso sin refresh:

1. Suscripcion realtime en vista publica de propiedad (`postgres_changes` sobre `crm.properties`).
2. Al detectar update de la propiedad, recargar bloque de media en cliente.
3. Ver checklist operativo en `docs/50-crm/03-public-realtime-checklist.md`.

> Nota: normalmente no es imprescindible; con Fase 3 ya tendras actualizacion inmediata en el siguiente refresh.

## Orden de ejecucion recomendado

1. Fase 1 (API upload).
2. Fase 2 (UI CRM upload).
3. Fase 3 (web publica en vivo).
4. Fase 4 (higiene/robustez).
5. Fase 5 opcional (realtime sin refresh).

## Riesgos a controlar

- Cambiar fuente de datos publica (JSON -> CRM) sin romper filtros/SEO.
- Politicas de bucket/ACL en Supabase mal configuradas.
- Cache CDN del navegador mostrando imagen antigua.
- Mapeo incompleto de campos legacy (`listing_type`, `slugs`, `seo`).

## Definition of done

- Flujo end-to-end validado:
  - subir PNG en CRM,
  - almacenado en Storage en carpeta correcta,
  - guardado en `crm.properties.media`,
  - visible en web publica sin redeploy.
