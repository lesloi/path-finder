import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4173;
const BROUTER_PORT = 17_778;
const CI = Boolean(process.env.CI);
// Rolling hills written by `fake-bdalti.ts`, for the elevation gain.
const BDALTI_DIR = join(tmpdir(), 'path-finder-e2e-bdalti');

/** End-to-end tests (`pnpm test:e2e`): the built web app, served by the API as in production. */
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
  webServer: [
    {
      // A stand-in for BRouter, so a scenario can generate routes without the real engine and its data.
      command: 'node fake-brouter.ts',
      url: `http://127.0.0.1:${BROUTER_PORT}/health`,
      reuseExistingServer: !CI,
      env: { FAKE_BROUTER_PORT: String(BROUTER_PORT) },
    },
    {
      // What `pnpm start` runs, rather than the Vite dev server, so headers, static serving and `build-id` are
      // the real ones. Not `pnpm start` itself: pnpm puts the server in its own process group, which outlives
      // Playwright's stop and holds CI open.
      command: `node e2e/fake-bdalti.ts "${BDALTI_DIR}" && pnpm build && exec node apps/api/src/main.ts`,
      cwd: '..',
      url: `http://localhost:${PORT}/health`,
      reuseExistingServer: !CI,
      env: {
        PORT: String(PORT),
        BROUTER_URL: `http://127.0.0.1:${BROUTER_PORT}`,
        BDALTI_DIR,
      },
    },
  ],
});
