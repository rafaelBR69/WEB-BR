# Deploy checklist

## Build

- Production build command: `npm run build:production:web`
- Expected output directory: `dist/web`
- Do not use `npm run build` for this migration rollout.

## Validate build surface before upload

1. Run `npm run build:production:web` from the repo root.
2. Confirm `dist/web` exists and contains the built public web output.
3. Review `migration/redirect-target-validation.csv` and confirm every deployed target shows `route_exists_in_build = yes`.
4. Spot-check the highest-risk validated target: `/es/sell-with-us/` must exist in the public web build.

## Nginx reload

1. Copy `migration/nginx-blancareal-redirects.conf` to the server include path.
2. Run `sudo nginx -t`.
3. Reload with `sudo systemctl reload nginx` or `sudo service nginx reload`.

## Verify 301 and 200 after deploy

1. Run `curl -I https://www.blancareal.com/blog/` and confirm `301` with the expected `Location`.
2. Run `curl -I -L https://www.blancareal.com/blog/` and confirm the final response is `200`.
3. Repeat the same check for the priority sample in `migration/post-deploy-url-checks.csv`.
4. If any legacy URL produces an extra hop or ends in `404`, stop rollout and compare against `migration/redirect-target-validation.csv` and `migration/manual-review-hold.csv`.