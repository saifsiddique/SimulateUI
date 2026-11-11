import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src/wasm/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    // core/ is pure (context.md 5.3): no DOM, no Node, no rendering libraries.
    files: ['src/core/**/*.ts'],
    languageOptions: { globals: { ...globals.es2025 } },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'three',
            'three/*',
            'svelte',
            'svelte/*',
            'node:*',
            '**/render/**',
            '**/ui/**',
          ],
        },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'self', 'localStorage'],
    },
  },
);
