// web/vite.config.mjs
//
// Multi-page build: dashboard (/) and Deep Analysis (/analysis.html).
// Builds into ../public/ so the output lands alongside the existing
// public/vendor/. emptyOutDir: false ensures the build does not wipe
// any pre-existing files in public/.
//
// In dev (npm run dev), /api/v1/* is proxied to the production droplet so
// charts render with real data. No staging env exists; treat the dev server
// as a read-only window onto prod data.

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

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
      input: {
        index:    resolve(__dirname, "index.html"),
        analysis: resolve(__dirname, "analysis.html"),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  server: {
    port: 5173,
    fs: {
      // Allow Vite to serve files from the repo root. Chart components import
      // ../../../src/rates.mjs (the pure-data constants module) for the
      // model-display configuration. Production Rollup build follows
      // filesystem paths fine; this is dev-only.
      allow: [".."],
    },
    proxy: {
      "/api": {
        target: "https://meter.vsits.co",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
