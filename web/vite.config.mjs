// web/vite.config.mjs
//
// Builds the dashboard into ../public/ so it lands alongside the existing
// public/analysis.html and public/vendor/. emptyOutDir: false ensures the
// build does not wipe those existing files.
//
// In dev (npm run dev), /api/v1/* is proxied to the production droplet so
// charts render with real data. No staging env exists; treat the dev server
// as a read-only window onto prod data.

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
  base: "/",
  build: {
    outDir: "../public",
    emptyOutDir: false,
    assetsDir: "assets",
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "https://meter.vsits.co",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
