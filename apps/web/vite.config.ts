import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { randomUUID } from 'node:crypto';
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

export default defineConfig({
  plugins: [react(), tailwindcss(), buildId()],
  // In dev, keep one copy of maplibre-gl-shared for the page and its worker.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  worker: { format: 'es' },
  // The API (`apps/api`, port 3000) serves the built app on the same origin in production.
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
