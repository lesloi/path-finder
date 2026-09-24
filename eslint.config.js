// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['**/dist/*', '**/.expo/*'],
  },
  {
    // React is installed in apps/mobile only, so "detect" can't find it from the root.
    settings: { react: { version: require('./apps/mobile/package.json').dependencies.react } },
  },
]);
