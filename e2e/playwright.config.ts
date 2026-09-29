import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const CI = Boolean(process.env.CI);

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
  webServer: {
    // What `pnpm start` runs, rather than the Vite dev server, so headers, static serving and `build-id` are
    // the real ones. Not `pnpm start` itself: pnpm puts the server in its own process group, which outlives
    // Playwright's stop and holds CI open.
    command: 'pnpm build && exec node apps/api/src/index.ts',
    cwd: '..',
    url: `http://localhost:${PORT}/health`,
    reuseExistingServer: !CI,
    env: {
      PORT: String(PORT),
      // No scenario generates routes yet: nothing listens here until one needs a fake BRouter (#9).
      BROUTER_URL: 'http://127.0.0.1:9',
    },
  },
});
