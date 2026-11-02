import baseConfig, {
  compositionStaysAtTheShell,
  importsContained,
} from '../../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
            // The journals and the chaos harness: test material, never shipped.
            '{projectRoot}/test/**/*',
          ],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
  {
    ignores: ['**/out-tsc'],
  },
  compositionStaysAtTheShell(['**/src/**/*.ts', '**/src/**/*.tsx']),
  importsContained(['**/src/**/*.ts'], ['workflow']),
];
