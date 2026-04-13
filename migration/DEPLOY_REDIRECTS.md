# Deploy redirects on IONOS Nginx

## Files

- Redirect map snippet ready for deploy/include: `migration/nginx-blancareal-redirects.conf`
- Repo mirror of the same generated snippet: `ops/nginx/blancareal-redirects.conf`
- Manual exceptions: `migration/manual-review-hold.csv`
- Route validation report: `migration/missing-target-routes.md`
- i18n review: `migration/i18n-review.md`
- Public web build command: `npm run build:production:web`
- Expected public output: `dist/web`

## Placement

1. Copy `migration/nginx-blancareal-redirects.conf` to the server, for example:
   - `/etc/nginx/snippets/blancareal-redirects.conf`
2. Include the file inside the global `http {}` context, not directly inside a `location {}` block.
3. In each relevant `server {}` block that serves legacy traffic, add:

```nginx
if ($blancareal_legacy_redirect_target != "") {
    return 301 $blancareal_legacy_redirect_target;
}
```

4. Apply that `if` to:
   - the `www.blancareal.com` server block
   - the `blancareal.com` server block that serves the public web surface
5. Keep the generated root exception as-is: the bare-host `/` redirect is intentionally not in the map.

## Validate configuration

```bash
sudo nginx -t
```

If the config test passes, reload Nginx:

```bash
sudo systemctl reload nginx
```

If the server uses the legacy service command set:

```bash
sudo service nginx reload
```

## Verify 301 responses

Use `curl -I` against high-priority old URLs and confirm:
- status is `301`
- `Location` points directly to the final `https://blancareal.com/{lang}/...` URL
- there is no intermediate hop

Examples:

```bash
curl -I https://www.blancareal.com/blog/
curl -I https://www.blancareal.com/contact/
curl -I https://www.blancareal.com/property/amazing-duplex-penthouse-fuengirola/
curl -I https://www.blancareal.com/how-can-i-legally-rent-my-property-to-tourists-in-andalusia/
```

## Check for chains and destination 404s

1. Test a priority sample from `scripts/seo-migration/reference/gsc_priority_urls.csv`.
2. Follow each redirect once with `curl -I -L` and confirm the final response is `200`.
3. Spot-check all section fallbacks (`/posts/`, `/projects/`, `/properties/`, `/contact/`).
4. If any response lands on a `404` or another `301`, stop rollout and compare it with `migration/missing-target-routes.md`.

## Current deployable redirect count

- 79 approved redirects resolved to existing routes and were included in the generated Nginx map.
