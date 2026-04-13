# Deploy build fix

## Why a change is needed

- The approved redirect map uses public-web targets that belong to the dedicated web surface under `apps/web/src/pages`.
- I verified that 1 approved redirect target(s) are missing from the root surface, so a deployment that still uses `npm run build` can produce 301 -> 404 for those paths.

## Safe repo change prepared

- Added `build:production:web` to the root `package.json` as an explicit alias to `npm run build:web`.
- Updated public-web deployment documentation to point to `npm run build:production:web` and `dist/web`.

## External deployment change to apply

1. Ensure the external production build command is `npm run build:production:web`, not `npm run build`.
2. Ensure the runtime/start step serves the `dist/web` output, not the root `dist` output.
3. Keep CRM deployment separate; do not repoint any CRM process to the web surface.

## No destructive repo changes applied

- I did not replace the existing root `build` script because that could affect other environments still relying on it.