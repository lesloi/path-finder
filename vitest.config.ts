import { configDefaults, defineConfig } from 'vitest/config';

// The web app's unit tests (`pnpm test`): fast, no network. They call functions and components directly.
// The server's tests are Go's (`go test ./...` in `apps/server`).
const UNIT_TESTS = { include: ['**/*-test.{ts,tsx}'], exclude: [...configDefaults.exclude] };

export default defineConfig({
  test: {
    globals: true,
    projects: [
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
        // The entry point that mounts the app.
        'apps/web/src/main.tsx',
      ],
      reporter: [['text', { skipFull: false }], 'lcov'],
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
});
