# Progress Log

## 2026-03-13

- Continued the migration from facade-based `@shared/*` modules to canonical shared implementation.
- Previously moved the low-risk public-property helper graph into `packages/shared`.
- In this iteration, moved the auth/access block into `packages/shared`:
  - `@shared/crm/auth`
  - `@shared/crm/access`
  - `@shared/portal/auth`
  - `@shared/portal/email`
- In this iteration, also moved the remaining domain cores into `packages/shared`:
  - `@shared/portal/domain`
  - `@shared/properties/domain`
  - `@shared/clients/domain`
- In this iteration, also moved the next support/storage block into `packages/shared`:
  - `@shared/leads/domain`
  - `@shared/properties/storage`
  - `@shared/properties/mockStore`
  - `@shared/clients/documentsStorage`
- In this iteration, also moved the final agency block into `packages/shared`:
  - `@shared/agencies/analytics`
  - `@shared/agencies/crud`
- Replaced the original `src/utils/*` files for those modules with compatibility wrappers pointing to `@shared/*`.
- Validation after the latest pass:
  - `npm run build:web` OK
  - `npm run build:crm` OK
  - `npm run build` OK
- Current state:
  - app trees are clean at the import boundary
  - public-property helpers, auth/access helpers, core CRM domain modules, the leads/storage block, and the agency layer are canonical in `packages/shared`
  - the next phase is cleanup rather than domain migration:
    - reduce old compatibility wrappers where safe
    - review residual root-only imports/aliases
    - finalize docs and deploy guidance for the split monorepo
