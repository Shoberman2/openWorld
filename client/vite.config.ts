import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const API = 'http://localhost:4317';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: {
    port: 5317,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/ws': { target: API.replace('http', 'ws'), ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  // The public web demo is the same client built with OPENWORLD_DEMO_BUILD=1 (scripts/vercel-build.mjs).
  define: { __OW_DEMO__: JSON.stringify(process.env.OPENWORLD_DEMO_BUILD === '1') },
});
