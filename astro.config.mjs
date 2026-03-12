import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import vercel from "@astrojs/vercel";
import path from "node:path";

import react from "@astrojs/react";

const adapter = process.env.VERCEL
  ? vercel()
  : node({
      mode: "standalone",
    });

export default defineConfig({
  output: "server",
  adapter,

  vite: {
    // Avoid Windows rename/lock issues in node_modules/.vite (ENOENT on deps -> deps_temp_*).
    cacheDir: ".astro/vite-cache",
    resolve: {
      alias: {
        "@": path.resolve("./src"),
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
        "@dnd-kit/utilities"
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
