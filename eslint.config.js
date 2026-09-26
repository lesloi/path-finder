import { builtinModules } from 'node:module';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default defineConfig([
  { ignores: ['**/dist/', '**/coverage/'] },
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    // Route generation stays plain TypeScript, testable without a browser or a server.
    files: ['apps/api/src/route-generation/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: builtinModules,
          patterns: ['node:*', 'hono', 'hono/*', '@hono/*', 'react', 'react-*', 'maplibre-gl'],
        },
      ],
    },
  },
]);
