import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { getRpcEndpoints } from "@monolythium/core-sdk";

const testnetRpc = getRpcEndpoints("testnet-69420")[0]?.url;
const productionSourcemaps = process.env.VITE_MONOSCAN_SOURCEMAP === "true";
const localRpcProxy = testnetRpc
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
  : undefined;

// Monoscan is a public web SPA served as static dist/ behind Caddy/nginx.
export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: productionSourcemaps,
    outDir: "dist",
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: localRpcProxy,
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: localRpcProxy,
  },
});
