# Findings

## 2026-03-13

- Surface-based deployment already works through `APP_DEPLOY_SURFACE=web|crm` in `src/middleware.ts`.
- The repo has real app entrypoints:
  - `apps/web`
  - `apps/crm`
- The root app still works because legacy `src/pages/*` routes are thin wrappers that forward into the app-specific trees.
- Both separated surfaces build independently:
  - `npm run build:web` -> `dist/web`
  - `npm run build:crm` -> `dist/crm`
- `apps/web/src` and `apps/crm/src` no longer import `@/utils/*` directly.
- The public-property and presentation helper graph is canonical in `packages/shared`.
- CRM and portal auth/access are now also canonical in `packages/shared`:
  - `@shared/crm/auth`
  - `@shared/crm/access`
  - `@shared/portal/auth`
  - `@shared/portal/email`
- The heavier CRM domain cores are now canonical in `packages/shared` too:
  - `@shared/portal/domain`
  - `@shared/properties/domain`
  - `@shared/clients/domain`
- Additional support/storage modules are now canonical in `packages/shared`:
  - `@shared/leads/domain`
  - `@shared/properties/storage`
  - `@shared/properties/mockStore`
  - `@shared/clients/documentsStorage`
- The remaining agency modules are now canonical in `packages/shared` too:
  - `@shared/agencies/analytics`
  - `@shared/agencies/crud`
- The corresponding files under `src/utils/*` for those modules are now compatibility wrappers that re-export from `@shared/*`.
- Remaining work is no longer about core/shared business logic. It is now cleanup:
  - trimming old compatibility wrappers where safe
  - removing residual root-only aliases/imports
  - finalizing deploy/docs around `apps/web`, `apps/crm`, and `packages/shared`
- Current validation status after the latest migration step:
  - `npm run build:web` OK
  - `npm run build:crm` OK
  - `npm run build` OK
