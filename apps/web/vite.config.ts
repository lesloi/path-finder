import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// Each build gets its own ID, as `import.meta.env.VITE_BUILD_ID` and in `dist/build-id`.
// The API reads the file and answers 426 to a tab left open across a deploy.
function buildId(): Plugin {
  const id = randomUUID();
  return {
    name: 'build-id',
    apply: 'build',
    config: () => ({ define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(id) } }),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build-id', source: id });
    },
  };
}

// The service worker is its own file at the root, not a hashed chunk: the browser looks for it by URL.
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    buildStart() {
      this.emitFile({ type: 'chunk', id: fileURLToPath(new URL('src/sw/sw.ts', import.meta.url)), fileName: 'sw.js' });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), buildId(), serviceWorker()],
  // In dev, keep one copy of maplibre-gl-shared for the page and its worker.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  worker: { format: 'es' },
  // The server (`apps/server`, port 3000, or API_PORT) serves the built app on the same origin in production.
  // PORT is the one a preview tool hands out for the web app.
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 3000}` },
  },
});
