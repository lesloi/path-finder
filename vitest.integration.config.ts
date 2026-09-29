import { defineConfig } from 'vitest/config';

import { INTEGRATION_TESTS } from './vitest.config.ts';

// Integration tests (`pnpm test:integration`): the API through HTTP. Those with the routing engine faked
// need no Docker; the tests against a real BRouter container (#13) join this suite.
export default defineConfig({
  test: {
    name: 'integration',
    root: './apps/api',
    include: [INTEGRATION_TESTS],
    globals: true,
  },
});
