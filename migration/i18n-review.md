# Astro i18n review

## Scope reviewed

- `astro.config.mjs`
- `apps/web/astro.config.mjs`
- `config/create-astro-config.mjs`
- `packages/shared/src/i18n/languages.ts`
- `apps/web/src/pages/index.astro`
- representative `[lang]/*` route files under `apps/web/src/pages`

## Findings

- Astro i18n config is not enabled in the reviewed config files. There is no `i18n` block, so `prefixDefaultLocale` and `redirectToDefaultLocale` are not configured.
- Supported locales are handled manually through the `[lang]` route tree and `DEFAULT_LANG = "es"` in `packages/shared/src/i18n/languages.ts`.
- The web surface root route in `apps/web/src/pages/index.astro` issues a `302` redirect from `/` to `/${DEFAULT_LANG}/`, which currently means `/es/`.
- Individual `[lang]` routes guard invalid language params and redirect to the default-language section, usually with `302` responses. That behavior does not conflict with the approved Nginx redirects because the redirect targets already point to final language-prefixed URLs.
- Astro v6's `redirectToDefaultLocale` restriction is not a blocker here because the feature is not being used at all.

## Safe deployment implications

- The generated Nginx map keeps the legacy root redirect only on `www.blancareal.com`. It intentionally omits `/` for bare `blancareal.com` so production does not override Astro's current `/ -> /es/` behavior on the canonical host.
- All other approved legacy exact-path redirects are mirrored onto bare `blancareal.com`, because those old paths are outside the live language-prefixed route space and do not collide with current Astro pages.
- No redirect loop was detected in the approved set: Nginx points directly to final `https://blancareal.com/{lang}/...` URLs, and Astro does not add another locale redirect on those resolved targets.

## Build-surface risk

- The web deployment must use the web surface config (`apps/web/astro.config.mjs`) through `npm run build:production:web`.
- The repo-level default build command still points to `astro build` with the root config. That surface does not include every route used by the approved redirect map, notably `apps/web/src/pages/[lang]/sell-with-us/index.astro` has no equivalent under `src/pages`.
- I did not change the build command automatically because that is a deployment/workflow decision, not a clearly safe code-only fix.

## Route validation result

- All approved redirect targets resolve in the web surface that was reviewed.
