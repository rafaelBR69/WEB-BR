# Build surface review

## Files inspected

- `package.json`
- `apps/web/package.json`
- `README.md`
- `produccion.txt`
- deployment-related repo paths (`.github/`, `deploy/`, `ci/`)

## Script inventory

- Root `build`: `astro build`
- Root `build:web`: `node scripts/run-surface.mjs web build --config ./apps/web/astro.config.mjs`
- Root `build:production:web`: `npm run build:web`
- apps/web `build`: `node ../../scripts/run-surface.mjs web build --config ./astro.config.mjs`

## Deployment evidence found in repo

- No IONOS-specific deploy script, CI workflow, systemd unit, PM2 config, Docker deploy file, or shell deploy script was found in the repository.
- `produccion.txt` is empty, so it does not define the production build command.
- `README.md` documents public-web deployment with `npm run build:production:web`: yes.

## Conclusion

- The repository does not encode the live IONOS build command with certainty.
- The repo now exposes an explicit public-web production command: `npm run build:production:web`.
- That command resolves to the dedicated web surface under `apps/web`, not to the root Astro surface.
- The root command `npm run build` remains in the repo for the legacy/root surface and should not be used for this SEO migration rollout.
- The root surface is not sufficient for the approved redirect targets: 1 target(s) used by redirects are missing there.

## Recommended production build command

- `npm run build:production:web`
- This is currently an explicit alias to `npm run build:web`.
- If the server launch step is managed externally, it should run against the generated `dist/web` output.