import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAstroConfig } from "../../config/create-astro-config.mjs";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, "../..");

export default createAstroConfig({
  repoRoot,
  rootDir: repoRoot,
  srcDir: path.join(repoRoot, "apps", "crm", "src"),
  publicDir: path.join(repoRoot, "apps", "crm", "public"),
  distDir: path.join(repoRoot, "dist", "crm"),
  cacheDir: path.join(configDir, ".astro", "vite-cache"),
});
