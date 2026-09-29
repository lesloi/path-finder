import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests only (`pnpm test`): fast, no network, BRouter mocked. They call functions and components
// directly; tests through HTTP run in the integration suite (`vitest.integration.config.ts`, #88).
export const INTEGRATION_TESTS = '**/*-integration-test.{ts,tsx}';
const UNIT_TESTS = { include: ['**/*-test.{ts,tsx}'], exclude: [...configDefaults.exclude, INTEGRATION_TESTS] };

export default defineConfig({
  test: {
    globals: true,
    projects: [
      { extends: true, test: { ...UNIT_TESTS, name: 'api', root: './apps/api' } },
      {
        extends: true,
        test: {
          ...UNIT_TESTS,
          name: 'web',
          root: './apps/web',
          environment: 'jsdom',
          setupFiles: ['./src/test-setup.ts'],
        },
      },
    ],
    coverage: {
      include: ['apps/*/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*-test.{ts,tsx}',
        '**/*.d.ts',
        '**/test-setup.ts',
        // Entry points that only start the server or mount the app.
        'apps/api/src/index.ts',
        'apps/web/src/main.tsx',
        // Only the integration suite, left out of this coverage, calls its routes (#88).
        'apps/api/src/app.ts',
      ],
      reporter: [['text', { skipFull: false }], 'lcov'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
