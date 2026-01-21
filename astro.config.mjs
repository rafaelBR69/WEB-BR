import { defineConfig } from "astro/config";
import path from "node:path";

export default defineConfig({
  vite: {
    resolve: {
      alias: {
        "@": path.resolve("./src"),
      },
    },
  },
});
