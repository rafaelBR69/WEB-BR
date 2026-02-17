# Rutas e idiomas

## Idiomas soportados

Definidos en `src/i18n/languages.ts`:

- es
- en
- de
- fr
- it
- nl

Idioma por defecto: `es`.

## Patron de rutas

- Home: `/{lang}/`
- Propiedades (listado): `/{lang}/properties/`
- Propiedad (detalle): `/{lang}/property/{slug}/`
- Proyectos: `/{lang}/projects/`
- Mapa: `/{lang}/map/`
- About: `/{lang}/about/`
- Posts listado: `/{lang}/posts/`
- Post detalle: `/{lang}/post/{slug}/`

## Comportamiento cuando el idioma o slug no coincide

- Si `lang` no es valido: redireccion a idioma por defecto.
- Si entras a slug de otro idioma:
  - Propiedades y posts redirigen al slug del idioma actual si existe.

## Canonical y hreflang

Controlados en `src/layouts/BaseLayout.astro`.

- Canonical sin query params.
- Selector de idioma construye URL equivalente de la ruta actual.

## Rutas SEO semanticas de propiedades

Archivo: `src/pages/[lang]/properties/[...slug].astro`

Convierte rutas como:

- `/{lang}/properties/mijas/`
- `/{lang}/properties/mijas/la-cala/`
- `/{lang}/properties/mijas/villas/`

a query interna:

- `/{lang}/properties/?city=...&area=...&type=...`

