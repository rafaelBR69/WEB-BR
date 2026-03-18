# Guia SEO corta de `properties`

## Idea clave

Tenemos 2 tipos de URLs:

1. URLs SEO limpias
   - Ejemplo: `/es/properties/mijas/`
   - Ejemplo: `/es/properties/marbella/pisos/`
   - Ejemplo: `/es/properties/fuengirola/torreblanca/`

2. URLs con filtros
   - Ejemplo: `/es/properties/?city=mijas`
   - Ejemplo: `/es/properties/?city=marbella&type=pisos`

La regla es simple:

- Las URLs limpias son las que queremos posicionar.
- Las URLs con filtros sirven para navegar y captar leads, no para SEO.

## Que hay que indexar

Indexamos solo landings limpias que cumplan esto:

- tienen stock visible
- tienen una intencion clara
- tienen sentido comercial
- estan en sitemap

Hoy la estrategia buena es esta:

- ciudades
- zonas fuertes
- ciudad + tipo
- unas pocas zona + tipo
- unas pocas busquedas especiales

## Que no hay que indexar

No debemos empujar:

- URLs con `?city=`, `?area=`, `?type=`
- combinaciones raras sin stock
- muchas paginas casi iguales por atributos

Ejemplo:

- bien: `/es/properties/mijas/`
- mal como URL SEO principal: `/es/properties/?city=mijas`

## Como pensar cada tipo de landing

### 1. Ciudad

Sirve para busquedas amplias.

Ejemplos:

- `/es/properties/mijas/`
- `/es/properties/marbella/`
- `/es/properties/fuengirola/`
- `/es/properties/manilva/`

### 2. Zona

Sirve cuando la zona tiene nombre propio y demanda real.

Ejemplos:

- `/es/properties/mijas/la-cala/`
- `/es/properties/mijas/calahonda/`
- `/es/properties/mijas/las-lagunas/`
- `/es/properties/fuengirola/torreblanca/`

### 3. Ciudad + tipo

Suele funcionar muy bien porque mezcla ubicacion e intencion de compra.

Ejemplos:

- `/es/properties/mijas/pisos/`
- `/es/properties/mijas/casas/`
- `/es/properties/marbella/villas/`
- `/es/properties/fuengirola/pisos/`

### 4. Zona + tipo

Solo vale la pena en casos concretos.

Ejemplos:

- `/es/properties/mijas/la-cala/pisos/`
- `/es/properties/mijas/la-cala/villas/`
- `/es/properties/fuengirola/torreblanca/villas/`

### 5. Busquedas especiales

Solo unas pocas.

Ejemplos:

- `/es/properties/marbella/search/new-build/`
- `/es/properties/mijas/search/sea-view/`
- `/es/properties/marbella/search/villas-de-lujo/`

## Que estamos haciendo ahora

La estrategia actual es esta:

- una sola URL canonica por intencion
- los hubs solo enseñan landings validas
- el sitemap solo mete landings elegibles
- las URLs con filtros no son la apuesta SEO

Ejemplo importante:

- `/es/properties/mijas/pisos/` es la URL SEO fuerte
- `/es/properties/mijas/apartments/` puede existir como alias, pero redirige a la canonica

## Lo mas importante para marketing

Si quereis crear una landing nueva, haced estas 4 preguntas:

1. La busca alguien de verdad?
2. Tenemos stock suficiente?
3. Se entiende sola como pagina?
4. Es mejor que usar una landing mas amplia ya existente?

Si la respuesta es no, no conviene indexarla.

## Resumen muy corto

- Si la URL es limpia, puede ser SEO.
- Si la URL lleva filtros, no debe ser la principal para SEO.
- No hay que indexar todo.
- Hay que indexar pocas landings fuertes.

## Donde ver el estado real

Para ver que landings estan fuertes y cuales no:

- `GET /api/v1/seo/property-landings`

Ese endpoint dice por cada landing:

- cuantas propiedades tiene
- si es indexable
- si va en hubs
- si va en sitemap
