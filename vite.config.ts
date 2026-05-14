import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { getRpcEndpoints } from "@monolythium/core-sdk";

const testnetRpc = getRpcEndpoints("testnet-69420")[0]?.url;

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
    proxy: testnetRpc
      ? {
          "/rpc": {
            target: testnetRpc,
            changeOrigin: true,
            rewrite: () => "/",
          },
          "/api": {
            target: testnetRpc,
            changeOrigin: true,
          },
        }
      : undefined,
  },
});
