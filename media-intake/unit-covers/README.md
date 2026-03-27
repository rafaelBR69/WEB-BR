# Unit Cover Intake

Coloca aqui las portadas por unidad para promociones de obra nueva.

## Regla de nombres

- Usa el `legacy_code` exacto de la unidad como nombre de archivo.
- Ejemplos:
  - `PM0074-P1_1A.png`
  - `PM0011-B1P1_1A.jpg`
  - `PM0079-21.webp`

## Carpetas operativas aceptadas

- `Bloque 1`, `Bloque 2`, `Bloque 3` para `PM0011`
- `Edificio 1`, `Edificio 2`, `Edificio 3` para `PM0079`
- `New WEB BlancaReal Disponibilidad Almitak` para `PM0074`

## Flujo

1. Deja cada imagen dentro de la carpeta de su proyecto.
2. Revisa el mapeo detectado:
   - `npm run unit-covers:map`
3. Ejecuta una prueba:
   - `npm run unit-covers:import -- --dry-run`
4. Cuando el mapeo sea correcto:
   - `npm run unit-covers:import -- --apply --sync-crm`

## Responsive

La importacion genera un master optimizado en Supabase. La web publica ya sirve variantes para movil, tablet y escritorio via `srcset`.

## Proyectos preparados

- `A0126-Adosados-de-obra-nueva-en-Fuengirola` (2 unidades)
- `PM0011-Calahonda-Sunset-obra-nueva-en-Mijas` (93 unidades)
- `PM0074-Almitak-Orion-Collection-obra-nueva-en-Manilva` (46 unidades)
- `PM0079-Nylva-Homes-obra-nueva-en-Manilva` (45 unidades)
- `PM00642-Apartamentos-en-Fuengirola-Torreblanca` (3 unidades)
