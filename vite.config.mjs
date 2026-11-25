import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./ui", import.meta.url)),
  build: { outDir: fileURLToPath(new URL("./dist/ui", import.meta.url)), emptyOutDir: true },
  server: { host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:8787", "/healthz": "http://127.0.0.1:8787" } },
});
