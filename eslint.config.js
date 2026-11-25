// No plugins, so CI runs it with `npx eslint` and package.json stays dependency-free.
export default [
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { process: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } },
    rules: { 'no-empty': ['error', { allowEmptyCatch: false }], 'no-unused-vars': 'error', 'no-undef': 'error', eqeqeq: 'error', 'no-fallthrough': 'error' },
  },
];
