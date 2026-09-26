import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default defineConfig([
  { ignores: ['**/dist/', '**/coverage/'] },
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
]);
