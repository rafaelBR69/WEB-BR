# Task Plan

## Goal
Separate web and CRM gradually inside the same monorepo without breaking the current app, leaving real entrypoints for `apps/web` and `apps/crm` while preserving route and deployment compatibility.

## Current Phase
- `in_progress` Clean compatibility wrappers, residual imports, and deployment docs after the shared migration

## Phases
- `completed` Extract an initial `@shared/*` facade layer
- `completed` Add runtime and build support by surface (`web` and `crm`) in middleware and scripts
- `completed` Create initial `apps/web`, `apps/crm`, and `packages/shared` structure
- `completed` Make `apps/web/astro.config.mjs` and `apps/crm/astro.config.mjs` operational
- `completed` Validate `build:web`, `build:crm`, and root `build`
- `completed` Move CRM pages and APIs into `apps/crm` with compatibility wrappers in `src/pages`
- `completed` Copy `public/crm` into `apps/crm/public/crm` for isolated CRM builds
- `completed` Move public web and portal routes into `apps/web` with app-local `src/public`
- `completed` Move each app's presentation layer behind `@webapp` and `@crmapp`
- `completed` Neutralize `i18n`, `data`, `config`, and layout script imports for `apps/web`
- `completed` Replace shared-ready business imports with `@shared/*` across `apps/web` and `apps/crm`
- `completed` Remove direct `@/utils/*` imports from `apps/web/src` and `apps/crm/src`
- `completed` Make the public-property helper graph canonical in `packages/shared`
- `completed` Make CRM/portal auth and access helpers canonical in `packages/shared`
- `completed` Move the remaining CRM domain cores (`crmPortal`, `crmProperties`, `crmClients`) into `packages/shared`
- `completed` Move the remaining CRM support/storage helpers (`crmLeads`, `crmPropertyStorage`, `crmMockPropertyStore`, `crmClientDocumentsStorage`) into `packages/shared`
- `completed` Move the remaining agency support helpers (`crmAgencyAnalytics`, `crmAgencyCrud`) into `packages/shared`
- `in_progress` Clean remaining compatibility wrappers and finalize migration docs/scripts

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `Missing pages directory` during `npm run build:web` and `build:crm` | 1 | Fixed by resolving `repoRoot` from `import.meta.url` in `apps/*/astro.config.mjs` |
| `Cannot find package 'piccolore' imported from ...manifest...` after app config split | 1 | Fixed by pinning the real repo root and separate `cacheDir` values |
| Wrapper generation failed because old PowerShell lacked `System.IO.Path.GetRelativePath` | 1 | Fixed by regenerating relative paths with Node |
| Dynamic wrapper imports used `%5Bid%5D` in route segments and broke builds | 1 | Fixed by regenerating imports with proper unescaped relative paths |
| Root `npm run build` failed once with `EPERM` on `dist/web` | 1 | Not a code issue; it happened because root and surface builds were run in parallel against the same output tree |
| One large patch exceeded Windows command/path limits | 1 | Fixed by splitting the migration into smaller apply-patch batches |
