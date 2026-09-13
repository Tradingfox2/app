// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // test-results/ and playwright-report/ hold generated artifacts, including
    // minified trace bundles. A failed browser run would otherwise break the
    // lint gate — and CI — until someone deleted them by hand.
    ignores: ['dist/*', 'src/components/anatomy/ref/*', 'scripts/cmd-guard/vendor/*',
              'test-results/**', 'playwright-report/**', '.expo/**'],
  },
]);
