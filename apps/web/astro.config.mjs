import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAstroConfig } from "../../config/create-astro-config.mjs";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, "../..");

export default createAstroConfig({
  repoRoot,
  rootDir: repoRoot,
  srcDir: path.join(repoRoot, "apps", "web", "src"),
  publicDir: path.join(repoRoot, "public"),
  distDir: path.join(repoRoot, "dist", "web"),
  cacheDir: path.join(configDir, ".astro", "vite-cache"),
});
