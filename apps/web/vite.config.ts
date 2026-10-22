import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// The ID of a build is a hash of what it is built from, as `import.meta.env.VITE_BUILD_ID`: it names the service
// worker's cache, which a deploy of docs, CI or the server alone then leaves as it is. A random ID would empty it on
// every deploy. The sources are hashed, not the bundle, which does not see `public/`; the tests are left out, as editing
// one changes nothing the user gets.
function buildId(): Plugin {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const inputs = [
    'src',
    'public',
    'index.html',
    'package.json',
    'vite.config.ts',
    '../../pnpm-lock.yaml',
    '../server/contract/contract.json',
  ];
  const files = (path: string): string[] =>
    statSync(path).isDirectory()
      ? readdirSync(path)
          .sort()
          .filter((name) => !name.includes('-test.'))
          .flatMap((name) => files(join(path, name)))
      : [path];
  return {
    name: 'build-id',
    apply: 'build',
    config() {
      const hash = createHash('sha256');
      for (const file of inputs.flatMap((input) => files(join(root, input)))) {
        hash.update(relative(root, file)).update(readFileSync(file));
      }
      return { define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(hash.digest('hex').slice(0, 16)) } };
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
  worker: { format: 'es' },
  // The server (`apps/server`, port 3000, or API_PORT) serves the built app on the same origin in production.
  // PORT is the one a preview tool hands out for the web app.
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 3000}` },
  },
});
