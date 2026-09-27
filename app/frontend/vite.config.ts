import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Built into ../static, which the FastAPI backend serves. `npm run dev` proxies the API to the local backend on 8123.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "../static", emptyOutDir: true, chunkSizeWarningLimit: 3000 },
  server: { proxy: { "/api": "http://127.0.0.1:8123" } },
});
