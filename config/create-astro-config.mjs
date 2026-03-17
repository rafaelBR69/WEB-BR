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
      port: Number(process.env.PORT || 4321),
    },
    vite: {
      cacheDir,
      server: {
        host: true,
        strictPort: true,
        hmr: {
          protocol: "ws",
          host: process.env.HMR_HOST || "localhost",
          clientPort: Number(process.env.HMR_CLIENT_PORT || process.env.PORT || 4321),
          port: Number(process.env.HMR_PORT || process.env.PORT || 4321),
        },
      },
      resolve: {
        alias: {
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
