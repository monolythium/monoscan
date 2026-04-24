import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Monoscan is a public web SPA served as static dist/ behind Caddy/nginx
// (see ../CLAUDE.md section 4.3). No SSR, no Tauri.
export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: true,
    outDir: "dist",
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
