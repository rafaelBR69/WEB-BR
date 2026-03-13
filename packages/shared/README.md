# Shared Layer

Puente de migracion para separar la web publica y el CRM sin romper el repo actual.

Reglas:

- `packages/shared` solo reexporta o contiene logica comun.
- no debe importar desde `apps/web` ni `apps/crm`
- el codigo nuevo compartido debe entrar aqui antes que en una app concreta
