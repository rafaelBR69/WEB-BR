# Roadmap leads + dashboard KPI configurable

## Objetivo

Tener un guion de trabajo claro antes de tocar codigo para resolver 3 bloques:

1. Corregir la clasificacion de `canales de entrada` en los leads importados desde CSV para reducir `Otros` a los casos realmente no clasificados.
2. Permitir medir KPIs por `promocion` concreta y tambien en modo `todas las promociones`.
3. Disenar una base solida para que el dashboard pueda personalizarse por usuario y, en una segunda fase, permitir que el propio usuario cree sus graficos.

## Estado actual revisado en el repo (2026-03-02)

Archivos ya existentes:

- Importador de leads CSV: `scripts/import-crm-leads.mjs`
- Job actual de importacion: `scripts/lead-import/jobs/default-leads.json`
- Dashboard de leads: `src/pages/crm/leads/dashboard/index.astro`
- Frontend del dashboard de leads: `public/crm/leads-dashboard.js`
- API CRM de leads: `src/pages/api/v1/crm/leads.ts`
- Dashboard KPI de clientes/promociones: `src/pages/crm/clients/dashboard/index.astro`
- Frontend del dashboard KPI de clientes: `public/crm/clients-dashboard.js`
- API KPI de clientes/promociones: `src/pages/api/v1/clients/kpis.ts`

## Hallazgos reales antes de programar

### 1. El problema de `Otros` no viene solo del CSV; viene tambien de la logica actual

La clasificacion de `origin_type` se hace hoy en `scripts/import-crm-leads.mjs` mediante reglas heuristicas.

Problema detectado:

- El importador normaliza primero el texto con una funcion tipo `canonical(...)`.
- En esa canonizacion se pierden caracteres como `@`.
- Despues se intenta detectar emails con reglas como `c.includes("@")`.
- Resultado: varias fuentes que son claramente `email` terminan cayendo en `other`.

En otras palabras: parte del exceso de `Otros` no es porque falten columnas en el job, sino porque la regla actual no reconoce bien ciertos valores reales del CSV.

### 2. Valores reales de tus CSV que hoy se irian a `other`

Tras revisar los 4 CSV actuales de leads y cruzarlos con la logica de normalizacion actual:

- `Gestion de LEADS - NYLVA HOMES - LEADS (1).csv`
  - `info@blancareal.com`: 70
  - `eva@blancareal.com`: 6
  - `Greg Marrs`: 1
- `Gestion de LEADS - Calahonda Sunset - Leads.csv`
  - `Info@blancareal.com`: 32
  - `office@blancareal.com`: 22
  - `Contactos desde Serprocol`: 17
  - `eva@blancareal.com`: 16
  - `info@calahondasunset.es`: 15
  - `sales@blancareal.com`: 9
  - `Greg Marrs (Pirata)`: 2
- `Gestion de LEADS - Orion Collection - Fase Almitak - Leads.csv`
  - sin casos no mapeados con la logica actual
- `Gestion de Leads WhiteHills Villas - Leads.csv`
  - sin casos no mapeados con la logica actual

Impacto estimado con los CSV actuales:

- `190` filas terminan en `other` con la logica actual.
- De esas `190`, `170` parecen ser emails claros y deberian acabar en `email`, salvo decision de negocio distinta.
- Los casos que de verdad requieren criterio de negocio son pocos: sobre todo `Contactos desde Serprocol` y `Greg Marrs / Greg Marrs (Pirata)`.

### 3. El dashboard de leads ya existe, pero hoy es una vista fija

El dashboard de leads ya pinta KPIs y graficos, pero:

- no tiene selector de `promocion`
- no tiene opcion clara `Todas las promociones`
- no guarda preferencias de usuario
- no permite crear widgets o graficos nuevos

Lo importante es que la API actual de leads ya soporta filtro por `project_id`, asi que la base para `promocion / todas` ya existe.

### 4. El dashboard KPI de clientes ya tiene parte del trabajo hecho

El dashboard de clientes/promociones ya tiene:

- selector de promocion
- comparativa entre promociones
- calculo global en API

Pero hoy la UX esta pensada sobre todo para una `promocion activa`, no para un modo claro de `Todas las promociones` dentro del mismo tablero.

La ventaja es que `src/pages/api/v1/clients/kpis.ts` ya devuelve:

- KPIs globales
- comparativa por promocion
- desglose mensual
- canales
- estados

Conclusion: para este bloque, el mayor trabajo sera de frontend y contrato de UX, no de datos base.

### 5. El dashboard configurable por usuario es otro nivel de alcance

Esto no es una extension pequena del dashboard actual. Requiere:

- definir un registro de metricas y dimensiones validas
- decidir como guardar layouts y widgets por usuario
- evitar consultas arbitrarias o SQL libre
- controlar permisos, filtros y rendimiento

Si se intenta hacer esto antes de arreglar la taxonomia de canales, el usuario podra crear graficos sobre datos mal clasificados. Eso seria construir una capa flexible sobre una base defectuosa.

## Decision de orden recomendada

Orden propuesto:

1. Corregir taxonomia y normalizacion de canales.
2. Recalcular o backfillear leads ya cargados.
3. Anadir selector `Todas / Promocion` en dashboards.
4. Anadir personalizacion de layout por usuario.
5. Anadir constructor de graficos guiado.

Este orden evita rehacer graficos y reglas dos veces.

## Modelo funcional recomendado para canales de entrada

Punto clave de negocio:

- para negocio, valores como `Idealista`, `Formulario Web`, `Formulario Web BR`, `Landing`, `Fotocasa`, `Inmowi`, `Mail Lanzamiento`, `WA Natascha` o `Info@blancareal.com` no pueden desaparecer dentro de una agrupacion demasiado generica
- esos valores deben seguir existiendo como dimension visible y filtrable en reporting
- la agrupacion superior solo debe servir para resumir, no para sustituir el canal real

Separar claramente 3 niveles:

1. `channel_raw`
- valor exacto que llega del CSV
- ejemplo: `Info@blancareal.com`, `Idealista`, `WA Natascha`

2. `channel_detail`
- canal real de negocio, normalizado pero visible en filtros y KPIs
- ejemplos:
  - `idealista`
  - `formulario_web`
  - `formulario_web_br`
  - `landing`
  - `landing_calahonda_sunset`
  - `fotocasa`
  - `inmowi`
  - `clinmo`
  - `redes_sociales`
  - `mail_lanzamiento`
  - `wa_natascha`
  - `info_blancareal`
  - `office_blancareal`
  - `sales_blancareal`
  - `info_calahondasunset`
  - `contactos_serprocol`
  - `contactos_internos_referenciados`

3. `origin_type`
- familia corta para agrupar canales detallados
- valores actuales: `direct`, `website`, `portal`, `agency`, `provider`, `phone`, `whatsapp`, `email`, `other`

Regla importante:

- `origin_type` debe servir para agrupar.
- `channel_detail` debe servir para detallar, filtrar y pintar KPIs reales de negocio.
- `channel_raw` debe conservar la trazabilidad original.

Ejemplo practico:

- `Idealista`
  - `channel_raw = "Idealista"`
  - `channel_detail = "idealista"`
  - `origin_type = "portal"`
- `Formulario Web BR`
  - `channel_raw = "Formulario Web BR"`
  - `channel_detail = "formulario_web_br"`
  - `origin_type = "website"`
- `Info@blancareal.com`
  - `channel_raw = "Info@blancareal.com"`
  - `channel_detail = "info_blancareal"`
  - `origin_type = "email"`

Conclusiones para implementacion:

- `Idealista`, `Formulario Web`, `Formulario Web BR` y similares no deben considerarse "faltantes" en la taxonomia final
- deben existir como canales detallados oficiales
- lo que no debe ocurrir es que todos ellos se aplasten en un unico valor y luego no se puedan medir por separado

## Fase 1 - Auditoria y catalogo maestro de canales

Objetivo:

- dejar cerrado un catalogo editable de equivalencias entre valores reales del CSV y su clasificacion final

Tareas:

- extraer valores unicos de `CANAL DE ENTRADA`, `ORIGEN`, `Origen`, `Canal` de todos los CSV activos
- construir un catalogo maestro con estas columnas minimas:
  - `raw_value`
  - `channel_detail`
  - `origin_type`
  - `source_label`
  - `decision_status`
  - `notes`
- marcar explicitamente los casos pendientes de negocio
- congelar una version 1 del catalogo antes de tocar el importador

Entregable recomendado:

- `scripts/lead-import/reference/lead-source-catalog.csv`

Criterio de cierre:

- no queda ningun valor frecuente sin clasificar
- negocio valida los pocos casos ambiguos

## Fase 2 - Corregir el importador y el reporte de importacion

Objetivo:

- hacer que el importador clasifique bien `origin_type` y `source`
- dejar visibilidad sobre lo que sigue sin mapear

Tareas:

- leer primero el catalogo maestro antes de aplicar heuristicas
- detectar `email`, `phone` y `whatsapp` sobre el valor crudo, no sobre el texto ya canonizado
- guardar el valor original del canal dentro del payload importado
- separar mejor `channel_detail` y `origin_type`
- anadir al reporte final:
  - conteo por `origin_type`
  - conteo por `channel_detail`
  - lista de `raw_value` no mapeados
  - preview de reclasificaciones respecto a la version anterior

Archivos previsibles:

- `scripts/import-crm-leads.mjs`
- `scripts/lead-import/jobs/default-leads.json`
- `scripts/lead-import/README.md`
- nuevo catalogo de referencia en `scripts/lead-import/reference/*`

Criterio de cierre:

- los emails de los CSV actuales ya no terminan en `other`
- `Idealista`, `Formulario Web`, `Formulario Web BR`, `Landing` y equivalentes quedan visibles como canales detallados medibles
- los reportes de importacion ensenan claramente lo que sigue sin clasificar
- `other` queda reservado a casos realmente desconocidos o no decididos

## Fase 3 - Backfill o reclasificacion de leads ya cargados

Objetivo:

- corregir el historico ya importado sin romper duplicados, trazabilidad ni ediciones manuales

Opciones validas:

1. Reimportar con `update_existing`
- mas simple si el payload actual conserva suficiente informacion
- riesgo: tocar campos que ya hayan sido ajustados manualmente

2. Script de reclasificacion especifico
- recomendado
- actualiza solo `origin_type`, `source` y metadatos de importacion
- menor riesgo sobre la operativa comercial

Recomendacion:

- crear un script de backfill dedicado para reclasificar leads importados por CSV
- limitarlo a leads cuya fuente venga de importacion y cuyo canal original este trazado en `raw_payload`

Entregable recomendado:

- `scripts/lead-import/backfill-lead-sources.mjs`

Criterio de cierre:

- el historico ya cargado refleja la nueva clasificacion
- se genera reporte `before/after`
- no se alteran estados comerciales ni asignaciones fuera del alcance

## Fase 4 - Dashboard de leads con selector `Todas las promociones / Promocion`

Objetivo:

- poder medir leads en modo global y por promocion sin salir del dashboard

Tareas:

- anadir barra de filtros en `src/pages/crm/leads/dashboard/index.astro`
- incluir al menos:
  - selector `Todas las promociones`
  - selector por promocion concreta
  - selector por `canal detallado`
  - selector por `familia de canal`
  - opcion de persistir seleccion en navegador
- actualizar `public/crm/leads-dashboard.js` para:
  - cargar lista de promociones
  - pedir datos globales o filtrados por `project_id`
  - re-renderizar KPIs y graficos segun el filtro
- evaluar si el endpoint actual `src/pages/api/v1/crm/leads.ts` basta o si conviene crear un endpoint KPI dedicado

Recomendacion tecnica:

- empezar aprovechando el endpoint actual, porque ya soporta `project_id`
- si el dashboard configurable crece despues, separar mas adelante un endpoint `kpis`

Criterio de cierre:

- el usuario puede alternar entre `todas` y `una promocion`
- el usuario puede medir por `Idealista`, `Formulario Web`, `Formulario Web BR`, etc. sin perder la agrupacion superior
- todos los widgets del dashboard se actualizan con el mismo filtro
- la seleccion persiste al recargar

## Fase 5 - Dashboard KPI de clientes/promociones con opcion `Todas`

Objetivo:

- unificar la experiencia del dashboard KPI actual para que el usuario pueda ver una promocion o el total sin cambiar de pantalla

Tareas:

- anadir opcion `Todas las promociones` al selector actual
- usar en modo `Todas` los datos globales ya devueltos por `src/pages/api/v1/clients/kpis.ts`
- mantener en modo `Promocion` el comportamiento actual
- revisar textos y ayudas para que quede claro cuando el dato es global y cuando es de una promocion concreta

Buena noticia:

- esta fase parece principalmente de frontend, porque la API ya devuelve tanto agregado global como comparativa por promocion

Criterio de cierre:

- el dashboard de clientes funciona en modo `Todas` y en modo `Promocion`
- no hay duplicidad de pantallas para resolver lo mismo

## Fase 6 - Personalizacion del dashboard por usuario (MVP)

Objetivo:

- permitir que cada usuario adapte el tablero a su forma de trabajo sin entrar aun en un constructor libre completo

Alcance recomendado para MVP:

- mostrar u ocultar widgets
- reordenar widgets
- guardar promocion por defecto o modo `todas`
- guardar filtros por defecto
- guardar layout personal por usuario

No intentar aun en este MVP:

- formulas libres entre datasets
- SQL libre
- widgets totalmente arbitrarios sin restricciones

Modelo recomendado:

- una tabla de preferencias por usuario con JSON de layout
- opcion de tener una vista por defecto y mas adelante varias vistas guardadas

Posible tabla:

- `crm.dashboard_views`
  - `id`
  - `organization_id`
  - `user_id`
  - `dashboard_key`
  - `name`
  - `is_default`
  - `layout_json`
  - `filters_json`
  - `created_at`
  - `updated_at`

Criterio de cierre:

- un usuario puede reorganizar su dashboard y verlo igual al volver a entrar

## Fase 7 - Constructor guiado de graficos (v2)

Objetivo:

- permitir que el usuario cree sus propios graficos sin depender de desarrollo para cada nueva necesidad

Enfoque recomendado:

- no permitir consultas libres
- trabajar con un `registro de widgets`
- cada widget se construye con piezas controladas

Piezas minimas del constructor:

- dataset
  - `leads`
  - `client_project_reservations`
- dimension
  - `project`
  - `origin_type`
  - `source`
  - `status`
  - `nationality`
  - `month`
- metrica
  - `count`
  - `treated_rate`
  - `avg_ticket`
  - `active_reservations_pct`
  - otras metricas registradas
- tipo de grafico
  - `kpi`
  - `bar`
  - `line`
  - `donut`
  - `treemap`

Guardrails necesarios:

- maximo numero de widgets por vista
- maximo numero de series por widget
- sin cruces entre datasets en v1
- solo metricas y dimensiones registradas
- permisos por organizacion y usuario

Riesgo principal:

- si se intenta llegar a este nivel sin antes unificar taxonomias, nombres y contratos de API, el mantenimiento se dispara

Criterio de cierre:

- el usuario puede crear, editar, guardar y borrar un grafico sin tocar codigo
- el grafico respeta el mismo sistema de filtros y permisos del CRM

## Decisiones de negocio que debemos cerrar antes de programar

1. `Contactos desde Serprocol`
- decidir si debe ser `direct`, `agency`, `provider` o una `source` propia bajo una categoria superior

2. `Greg Marrs / Greg Marrs (Pirata)`
- decidir si es una fuente personal, colaborador, agencia o simplemente `other`

3. Emails de entrada
- decidir si todos los emails (`info@...`, `sales@...`, etc.) deben agruparse bajo `origin_type=email`
- recomendacion: si

4. Nombres visibles de fuente
- decidir si la UI debe ensenar el email real (`info@blancareal.com`) o una etiqueta editorial (`Info Blanca Real`)

5. Alcance del dashboard configurable
- decidir si la primera version solo permite personalizar widgets existentes
- o si debe incluir ya constructor de graficos

Recomendacion:

- v1 = personalizacion
- v2 = constructor guiado

## Criterios globales de exito

Se considerara bien resuelto cuando:

- `Otros` deje de absorber fuentes que ya conocemos
- exista trazabilidad entre valor crudo, categoria analitica y fuente fina
- los canales detallados de negocio (`Idealista`, `Formulario Web`, `Formulario Web BR`, etc.) sean visibles y medibles como tales
- los dashboards puedan verse en modo `todas` y en modo `promocion`
- el usuario pueda personalizar su tablero sin romper consistencia ni permisos
- los nuevos graficos se creen con reglas controladas y mantenibles

## Riesgos a vigilar

- reimportar historico sin estrategia de backfill puede tocar datos operativos que no queremos modificar
- mantener diccionarios de fuentes en varios frontends distintos provocara incoherencias
- permitir dashboards demasiado libres desde el principio puede romper rendimiento y soporte
- si no guardamos `channel_raw`, luego sera dificil auditar por que un lead cayo en cierta categoria

## Recomendacion final de implementacion

Plan minimo y sensato:

1. Catalogo de fuentes y correccion del importador.
2. Backfill del historico ya importado.
3. Selector `Todas / Promocion` en dashboard de leads.
4. Selector `Todas / Promocion` en dashboard KPI de clientes.
5. Personalizacion de layout por usuario.
6. Constructor guiado de graficos como segunda iteracion.

No recomiendo empezar por el constructor de graficos. Primero hay que arreglar la calidad del dato y unificar la experiencia de filtro.
