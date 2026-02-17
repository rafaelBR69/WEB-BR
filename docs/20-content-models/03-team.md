# Modelo de equipo

## Donde se guardan

- Archivos: `src/data/team/*.json`
- Registro manual: `src/data/team/index.ts`

## Campos base

- `id`
- `category` (`ceo`, `commercial`, `legal`, `investments`, `marketing`)
- `name`
- `role.{lang}`
- `spoken_languages` (lista de codigos de idioma)
- `photo.url`
- `photo.alt.{lang}`
- `bio.{lang}`

## Contacto

Compatibles:

- `email` simple
- o `emails` array con etiquetas
- `phone`

La pagina `about` normaliza ambos formatos.

## Orden visual

El orden de categorias esta en:

- `src/data/team/index.ts` (`TEAM_CATEGORY_ORDER`)

El orden de tarjetas dentro de cada categoria depende del orden en `teamMembers` de ese archivo.

