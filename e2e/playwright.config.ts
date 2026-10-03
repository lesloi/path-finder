import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4173;
const CI = Boolean(process.env.CI);
// The stand-in graph (rolling hills around Annecy, written by `cmd/standin`) and the server built beside it.
const GRAPH_DIR = join(tmpdir(), 'path-finder-e2e');

/** End-to-end tests (`pnpm test:e2e`): the built web app, served by the Go server as in production. */
export default defineConfig({
  testMatch: '**/*-test.ts',
  forbidOnly: CI,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  // Chromium only (#78), in each layout: the left column on desktops, the bottom sheet and touch on phones.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // The binary with the built web app, rather than the Vite dev server, so headers, static serving and `build-id`
    // are the real ones. Not `pnpm start` itself: pnpm puts the server in its own process group, which outlives
    // Playwright's stop and holds CI open.
    command: `pnpm build && cd apps/server && CGO_ENABLED=0 go run ./cmd/standin "${GRAPH_DIR}" && CGO_ENABLED=0 go build -o "${GRAPH_DIR}/server" . && exec "${GRAPH_DIR}/server"`,
    cwd: '..',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: !CI,
    env: {
      PORT: String(PORT),
      WEB_ROOT: join(import.meta.dirname, '../apps/web/dist'),
      GRAPH_FILE: join(GRAPH_DIR, 'graph.bin'),
      LANDMARKS_HIKE: join(GRAPH_DIR, 'hike.alt'),
      LANDMARKS_RUN: join(GRAPH_DIR, 'run.alt'),
      // Two projects run side by side: more than one generation at once must not get a 429.
      LOOP_LIMIT: '4',
    },
  },
});
