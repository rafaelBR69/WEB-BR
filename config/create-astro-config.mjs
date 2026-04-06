import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import vercel from "@astrojs/vercel";
import react from "@astrojs/react";
import path from "node:path";

export const createAstroConfig = ({
  repoRoot,
  rootDir = repoRoot,
  srcDir = path.join(repoRoot, "src"),
  publicDir = path.join(repoRoot, "public"),
  distDir = path.join(repoRoot, "dist"),
  cacheDir = path.join(rootDir, ".astro", "vite-cache"),
} = {}) => {
  const port = Number(process.env.PORT || 4321);
  const hmrHost = process.env.HMR_HOST?.trim();
  const hmrPort = process.env.HMR_PORT ? Number(process.env.HMR_PORT) : undefined;
  const hmrClientPort = process.env.HMR_CLIENT_PORT
    ? Number(process.env.HMR_CLIENT_PORT)
    : undefined;
  const hmrProtocol = process.env.HMR_PROTOCOL?.trim();

  const hmrConfig =
    hmrHost || hmrPort || hmrClientPort || hmrProtocol
      ? {
          protocol: hmrProtocol || "ws",
          ...(hmrHost ? { host: hmrHost } : {}),
          ...(hmrClientPort ? { clientPort: hmrClientPort } : {}),
          ...(hmrPort ? { port: hmrPort } : {}),
        }
      : undefined;

  const adapter = process.env.VERCEL
    ? vercel()
    : node({
        mode: "standalone",
      });

  return defineConfig({
    root: rootDir,
    srcDir,
    publicDir,
    outDir: distDir,
    output: "server",
    adapter,
    server: {
      host: true,
      port,
    },
    vite: {
      cacheDir,
      server: {
        host: true,
        strictPort: true,
        ...(hmrConfig ? { hmr: hmrConfig } : {}),
      },
      resolve: {
        alias: {
          "astro/entrypoints/prerender": path.join(
            repoRoot,
            "node_modules",
            "astro",
            "dist",
            "entrypoints",
            "prerender.js",
          ),
          "astro/entrypoints/legacy": path.join(
            repoRoot,
            "node_modules",
            "astro",
            "dist",
            "entrypoints",
            "legacy.js",
          ),
          "@": path.join(repoRoot, "src"),
          "@shared": path.join(repoRoot, "packages", "shared", "src"),
          "@webapp": path.join(repoRoot, "apps", "web", "src"),
          "@crmapp": path.join(repoRoot, "apps", "crm", "src"),
        },
      },
      optimizeDeps: {
        include: [
          "mapbox-gl",
          "@turf/helpers",
          "@turf/distance",
          "@turf/boolean-point-in-polygon",
          "aria-query",
          "axobject-query",
          "react",
          "react-dom",
          "react-is",
          "recharts",
          "@dnd-kit/core",
          "@dnd-kit/sortable",
          "@dnd-kit/utilities",
        ],
      },
      build: {
        commonjsOptions: {
          include: [/react-is/, /node_modules/],
        },
      },
    },
    integrations: [react()],
  });
};
