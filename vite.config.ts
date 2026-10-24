import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
  server: { host: "0.0.0.0", port: 5173, strictPort: true },
});
