# Progress Log

## 2026-03-19

- Started a planning-with-files track for a major redesign of `/sell-with-us/`.
- Reviewed:
  - `apps/web/src/pages/[lang]/sell-with-us/index.astro`
  - `apps/web/src/styles/pages/service-pages.css`
- Confirmed the page content is broadly sufficient, but the current presentation is too generic for a serious seller-conversion page.
- Logged the redesign goal and phase structure in `task_plan.md`.
- Logged the initial architectural/design findings in `findings.md`.
- Implemented a redesign of the page with:
  - a new high-trust hero shell
  - a more professional two-column body
  - a seller-oriented aside/form treatment
  - dedicated responsive behavior for tablet and mobile
- Validation:
  - `npm run build:web` OK

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

## 2026-03-16

- Used the planning-with-files workflow for the website backlog requested from the screenshot.
- Reviewed the existing planning files first to avoid losing prior repo context.
- Added a new roadmap section in `task_plan.md` with:
  - phase ordering
  - sprint grouping
  - dependency rules
- Logged key planning conclusions in `findings.md`, especially:
  - which backlog items are legal blockers
  - which items are already partially implemented in the repo
  - which tasks should be batched instead of executed one by one
- Outcome of this session:
  - backlog is now sequenced into 6 phases
  - early sprints are centered on compliance, home conversion, and contact safety
  - later sprints cover section expansion, new pages, and growth instrumentation

## 2026-03-17

- Started a new planning-with-files track for the requested real-estate simplification.
- Reviewed:
  - `apps/web/src/pages/[lang]/real-estate/index.astro`
  - `apps/web/src/pages/[lang]/properties/index.astro`
  - `apps/web/src/components/MapboxCostaMap.astro`
- Confirmed the work is a migration/recomposition task, not a greenfield map feature.
- Logged the migration goal and phases into `task_plan.md`.
- Logged the architectural findings into `findings.md`.
- Implemented the first migration pass:
  - `/real-estate/` now redirects to `/properties/`
  - `/properties/` now renders a first-row showcase with a compact map plus one featured property
  - the compact map auto-fits to the currently filtered unit set, so it reframes when city/area filters narrow the catalog
- Validation:
  - `npm run build:web` OK
