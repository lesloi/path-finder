import { defineConfig } from 'vitest/config';

// Unit tests only (`pnpm test`): fast, no Docker, BRouter mocked.
export default defineConfig({
  test: {
    include: ['**/__tests__/**/*.{ts,tsx}', '**/*-test.{ts,tsx}'],
    globals: true,
    projects: [
      { extends: true, test: { name: 'api', root: './apps/api' } },
      {
        extends: true,
        test: {
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
        '**/__tests__/**',
        '**/*-test.{ts,tsx}',
        '**/*.d.ts',
        '**/test-setup.ts',
        // Entry points that only start the server or mount the app.
        'apps/api/src/index.ts',
        'apps/web/src/main.tsx',
      ],
      reporter: [['text', { skipFull: false }], 'lcov'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
