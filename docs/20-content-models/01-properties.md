# Modelo de propiedades

## Donde se guardan

- `src/data/properties/*.json`

## Tipos de registro

- `listing_type: "promotion"` para proyecto padre
- `listing_type: "unit"` para vivienda/unidad

## Estados validos de negocio

- `available`: visible y comercializable
- `sold`: visible pero se excluye de varios listados/filtros
- `private`: no visible publicamente

## Relacion padre-hijo

- Cada unidad debe tener `parent_id` con el `id` de la promocion.
- Una promocion puede existir sin unidades, pero perdera informacion agregada (rangos y resumen).

## Campos minimos recomendados (promocion)

- `id`
- `slugs.{lang}`
- `status`
- `listing_type: "promotion"`
- `languages`
- `location.city`, `location.area`, `location.coordinates.lat`, `location.coordinates.lng`
- `translations.{lang}.title`
- `media.cover`

## Campos minimos recomendados (unidad)

- `id`
- `listing_type: "unit"`
- `parent_id`
- `slugs.{lang}`
- `status`
- `price`, `currency`
- `location.city`, `location.area`, `location.coordinates`
- `property.type`, `property.market`
- `translations.{lang}.title`

## Campos que impactan filtros

- Tipo: `property.type` (mapeado por `src/utils/matchType.ts`)
- Ciudad: `location.city`
- Zona: `location.area`
- Planta: `property.floor_label` o `property.floor_level`
- Dormitorios: `property.bedrooms`
- Estado mercado: `property.market`
- Precio: `price`

## Reglas importantes

- Filtro de planta excluye villas (`src/utils/floorFilter.ts`).
- `Planta 0` se normaliza a `Planta baja`.
- En mapa solo se muestran propiedades `available`.
- En mapa no se pintan unidades hijas (`listing_type=unit` con `parent_id`), solo promocion padre.

## Orden manual de proyectos destacados

Archivo: `src/pages/[lang]/projects/index.astro`

Variable: `pinnedProjectOrder`.

