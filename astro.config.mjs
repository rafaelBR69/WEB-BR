import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import path from "node:path";

export default defineConfig({
  output: "server",
  adapter: node({
    mode: "standalone",
  }),
  vite: {
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
      ],
    },
  },
});
