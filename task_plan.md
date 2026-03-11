# Task Plan

## Goal
Refinar el SEO de `A0126 / Sunhill` para mejorar posicionamiento sin canibalizar otras promociones activas de BlancaReal en Fuengirola y Mijas, y sincronizar los cambios en CRM.

## Phases
- [completed] Inventariar promociones y unidades relevantes de Fuengirola y Mijas con sus slugs, focus keyphrases y metas actuales.
- [completed] Redefinir el enfoque SEO de `A0126` para diferenciarlo por tipologia, precio y ambito geografico.
- [completed] Validar build y sincronizar `A0126` y sus unidades al CRM.

## Decisions
- `Sunhill` debe evitar el posicionamiento generico `obra nueva Fuengirola`, porque solapa con `White Hills` y `Luminal Home`.
- La diferenciacion principal para `Sunhill` sera `adosados/unifamiliares de obra nueva en Fuengirola`, no `villas`.
- Se mantienen separadas las promociones de Mijas por area y tipologia: `Calahonda Sunset` y `Almitak` siguen jugando como apartamentos/obra nueva en Mijas.

## Errors Encountered
- Un primer filtrado con `rg` fallo por sintaxis de expresion regular y argumentos mal escapados. Resolucion: extraer el inventario SEO con scripts Node sobre `src/data/properties`.
- El importador `migrate-properties-json-to-crm.mjs` no estaba pisando `slugs`, `translations` y `seo` en `A0126` y sus unidades, aunque el lote fuente era correcto. Resolucion: update directo en `crm.properties` para esas tres filas.
