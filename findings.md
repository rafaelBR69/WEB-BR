# Findings

## 2026-03-19 Sell-With-Us Refresh

- `/sell-with-us/` currently uses a fairly generic `service-hero + service-grid` composition that reads more like an internal placeholder than a high-trust seller acquisition page.
- The page already has solid copy structure in `apps/web/src/pages/[lang]/sell-with-us/index.astro`:
  - hero copy
  - proof points
  - why-sell bullets
  - scope-of-service bullets
  - SEO support text
  - form
  - related links
- The weak point is mostly presentation and hierarchy, not lack of content.
- `apps/web/src/styles/pages/service-pages.css` already contains much more advanced patterns for:
  - contact hero
  - contact grid panels
  - commercialization hero/layout
  These can be reused conceptually so `sell-with-us` reaches the same quality bar.
- Mobile-specific treatment for `sell-with-us` is currently almost nonexistent beyond generic grid collapse, so the redesign must include dedicated mobile rules.

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

## 2026-03-16 Website Backlog Planning

- The backlog in the screenshot is not a single stream of work. It mixes:
  - legal/compliance blockers
  - home conversion work
  - sitewide SEO/performance/accessibility items
  - section-level content/product tasks
  - net-new business pages
  - marketing instrumentation
- The highest-risk items are the legal/compliance ones because they affect forms, data collection, cookies, and public exposure of personal contact data.
- Several screenshot items are already partially addressed in the repo and must be re-audited before redoing:
  - privacy/cookies pages exist
  - consent handling has been added to home/contact
  - preload/preconnect/structured-data work has started on home
  - home H1/trust/value-prop work has started
  - collaborator accessibility work has already been touched
  - portal loading/access flow has been improved
- The clean sequencing is:
  1. compliance and contact safety
  2. home clarity and conversion
  3. core section UX/content
  4. sitewide SEO/a11y/performance hardening
  5. new pages/product surfaces
  6. analytics/growth validation
- Tasks marked across many areas but really sharing one dependency should be batched:
  - all cookie/RGPD items
  - all locale SEO tags/schema/hreflang items
  - all image/logo request optimization items
  - all carousel/ticker/language-switcher accessibility fixes
- The home backlog should not revert to a generic agency homepage. The repo already moved toward:
  - clearer value proposition
  - trust strip
  - customer-oriented nav
  - reduced contact exposure
  The next home pass should refine, not restart.

## 2026-03-17 Real Estate Consolidation

- `/real-estate/` is currently a full standalone page with:
  - hero
  - search form
  - full-width `MapboxCostaMap`
  - featured carousel
- `/properties/` already became the main catalog entry and now has the shared editorial header/subnav.
- `MapboxCostaMap.astro` already has enough behavior to support the new request:
  - feature-based rendering
  - reset and viewport controls
  - zone/subzone filtering
  - programmatic selection and zooming logic internally
- The new request is not about building new map capability from zero; it is about relocating and resizing the map experience into `/properties/`.
- The tricky part is the result count and listing logic split:
  - `/properties/` visually mixes promotions and units depending on filter intent
  - the user now wants the page emphasis to move toward unit inventory with contextual map support
- The safest migration path is:
  1. move the compact map into `/properties/`
  2. wire it to filtered/current context
  3. then demote `/real-estate/` to a redirect or thin shell
