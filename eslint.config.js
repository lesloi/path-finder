import { builtinModules } from 'node:module';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const TEXT_QUERY =
  '/^(get|query|find)(All)?By(Text|Label|LabelText|Placeholder|PlaceholderText|DisplayValue|Title|AltText)$/';
const ROLE_QUERY = '/^(get|query|find)(All)?ByRole$/';

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
  {
    // Tests find elements by `data-testid`, not by the labels they show: a label can change, or be
    // translated, without the test noticing. Roles without a name, such as `alert`, are fine.
    files: ['**/*-test.ts', '**/*-test.tsx', 'e2e/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `CallExpression:matches([callee.name=${TEXT_QUERY}], [callee.property.name=${TEXT_QUERY}])`,
          message: 'Find the element with its `data-testid` (`getByTestId`), not by its text, label, or title.',
        },
        {
          selector: `CallExpression:matches([callee.name=${ROLE_QUERY}], [callee.property.name=${ROLE_QUERY}]) > ObjectExpression > Property[key.name='name']`,
          message:
            'Find the element with its `data-testid`, not by its accessible name. Assert the name with `toHaveAccessibleName`.',
        },
        {
          selector: 'Property[key.name=/^(hasText|hasNotText)$/]',
          message: 'Find the element with its `data-testid`, not by the text it contains.',
        },
      ],
    },
  },
]);
