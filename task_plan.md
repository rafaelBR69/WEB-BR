# Task Plan

## 2026-03-19 Sell-With-Us Refresh

### Goal
Convert `/sell-with-us/` into a much more professional conversion page, with a stronger hero, clearer hierarchy, better trust framing, and a mobile experience intentionally designed instead of compressed.

### Current Phase
- `completed` Review the current page, redesign it for desktop/mobile, and validate the build

### Phases
- `completed` Redesign the hero and first-screen trust framing
- `completed` Recompose the content blocks into a clearer professional sales narrative
- `completed` Improve the lead form presentation and related conversion support
- `completed` Tighten the mobile/tablet layout so it feels intentional on small screens
- `completed` Validate with `npm run build:web`

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

---

## 2026-03-16 Backlog Roadmap

### Goal
Convert the current multi-area website backlog into an execution roadmap that protects legal/compliance first, then improves home conversion, then expands SEO/content/product surfaces without duplicating work already implemented.

### Current Phase
- `in_progress` Prioritize and sequence the full website backlog by risk, dependency, and sprint

### Phases
- `pending` Phase 1: Legal/compliance blockers and consent foundation
- `pending` Phase 2: Home conversion clarity and contact-path restructuring
- `pending` Phase 3: Core section UX/content improvements (`real-estate`, `legal`, `commercial`, `contact`, `nosotros`)
- `pending` Phase 4: Cross-site SEO, accessibility, performance, and social metadata hardening
- `pending` Phase 5: New business pages and portal/public-entry surfaces
- `pending` Phase 6: Growth instrumentation, content engine, and search-console/ads validation

### Recommended Sprint Sequence
- `Sprint 1`
  - Legal pages and real cookie/compliance base
  - Banner cookies with opt-in/out
  - Consent checkboxes on all public forms
  - PII exposure reduction for public team contacts
  - Locale meta description audit across key pages
- `Sprint 2`
  - Home: H1/value prop, CTA hierarchy, trust strip, section restructuring
  - Home: reduced team carousel plus 3 key contacts model
  - Contact: confirmation state, service preselection, Map embed, opening hours
  - Real Estate: page-level descriptions and improved listing/result clarity
- `Sprint 3`
  - Header language visibility
  - Localized schema and hreflang verification
  - Accessibility fixes for sliders/tickers/language selector
  - Image and logo request optimization
- `Sprint 4`
  - Legal trust content: case/examples, Maria profile, downloadable checklist
  - Commercial trust content: sub-pages, metrics, promoter form
  - Nosotros: names cleanup, history timeline, document/logos section
- `Sprint 5`
  - New pages: zone guides, buyer/seller process, investment pages, Golden Visa page
  - Portal public entry page and portal notification improvements
  - Blog support: author schema, EN/DE translation workflow, CTA into service verticals
- `Sprint 6`
  - Google Ads conversion setup and validation
  - Google Search Console + hreflang verification
  - Sitemap XML by locale
  - Ongoing content cadence and measurement loop

### Delivery Rules
- Do not treat the screenshot backlog as greenfield: re-audit items already partially implemented before reopening them.
- Every task touching forms, cookies, or PII must ship with a manual QA checklist.
- Every sitewide SEO/accessibility item should be bundled and deployed together by phase, not one by one.
- New pages should only start after Phase 1 and Phase 2 are stable in production.

---

## 2026-03-17 Real Estate Consolidation

### Goal
Remove the standalone `real-estate` landing as a full experience and move its map value into the main `/properties/` catalog, with a smaller contextual map on the first row, two cards next to it, and one highlighted property alongside. The map must react to the active area/city context by reframing and zooming.

### Current Phase
- `in_progress` Validate the new compact-map composition in `/properties/` and the redirect away from `/real-estate/`

### Phases
- `completed` Phase 1: Identify which `real-estate` behaviors must survive inside `/properties/`
- `completed` Phase 2: Restructure `/properties/` first row to include compact map + featured card layout
- `completed` Phase 3: Feed the map with filtered/current-context features and area-aware zoom behavior
- `completed` Phase 4: Reduce `/real-estate/` to a redirect or remove its standalone UX safely
- `pending` Phase 5: Validate navigation, filters, and map focus behavior across cities/areas
