# Playbook: reordenar proyectos

## Caso

Quieres que ciertos proyectos salgan primero en `/{lang}/projects/`.

## Archivo a tocar

- `src/pages/[lang]/projects/index.astro`

## Variable clave

- `pinnedProjectOrder`

Ejemplo:

```ts
const pinnedProjectOrder = ["PM0079", "PM0084", "PM0074"];
```

El orden del array es el orden visual.

## Como funciona despues

1. Primero ordena por `pinnedProjectOrder`
2. Luego por disponibilidad (`availableCount`)
3. Luego por porcentaje vendido

## Validacion

1. `npm run dev`
2. Abrir `/{lang}/projects/`
3. `npm run build`

