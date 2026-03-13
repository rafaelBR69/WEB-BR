import path from "node:path";
import { createAstroConfig } from "./config/create-astro-config.mjs";

const repoRoot = path.resolve(".");

export default createAstroConfig({
  repoRoot,
  rootDir: repoRoot,
  distDir: path.join(repoRoot, "dist"),
});
