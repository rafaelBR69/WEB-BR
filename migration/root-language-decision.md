# Root language decision

## Current behavior

- `apps/web/src/pages/index.astro` redirects `/` to `/es/` with `302`.
- The approved legacy redirect map sends `https://www.blancareal.com/` to `https://blancareal.com/en/`.
- The generated Nginx include intentionally leaves bare-host `https://blancareal.com/` under Astro control, so canonical root stays `/ -> /es/`.

## Impact

- Legacy English traffic hitting `www.blancareal.com/` lands on `/en/`, which preserves the approved migration intent for the old homepage.
- Direct visits to the canonical root `blancareal.com/` still land on `/es/`, which matches the current default language configured in code.
- This creates a split behavior at root level, but it is deterministic and avoids changing the site-wide default language without business approval.

## Recommendation

- Keep the current canonical root behavior: `/ -> /es/`.
- Keep the legacy homepage redirect on `www.blancareal.com/ -> /en/` because it is already approved in the migration source of truth.
- Revisit the default-language decision only if product/SEO explicitly wants the canonical host root to become English. That change should be handled as a separate language strategy task, not bundled into redirect deployment.