import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const [surface, command, ...rest] = process.argv.slice(2);

if (!surface || !command) {
  console.error("Usage: node scripts/run-surface.mjs <web|crm> <astro-command> [...args]");
  process.exit(1);
}

if (surface !== "web" && surface !== "crm") {
  console.error(`Invalid surface "${surface}". Use "web" or "crm".`);
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const astroEntrypoints = [
  path.join(repoRoot, "node_modules", "astro", "astro.js"),
  path.join(repoRoot, "node_modules", "astro", "bin", "astro.mjs"),
];
const astroBin = astroEntrypoints.find((candidate) => existsSync(candidate));

if (!astroBin) {
  console.error("Could not resolve Astro CLI entrypoint in node_modules/astro.");
  process.exit(1);
}

const child = spawn(process.execPath, [astroBin, command, ...rest], {
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    APP_DEPLOY_SURFACE: surface,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
