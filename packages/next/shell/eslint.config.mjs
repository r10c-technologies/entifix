import nx from '@nx/eslint-plugin';

import baseConfig, { mechanismsDoNotLog } from '../../../eslint.config.mjs';

export default [
  ...baseConfig,
  ...nx.configs['flat/react'],
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    // Override or add rules here
    rules: {},
  },
  {
    settings: { react: { version: '19.0.0' } },
  },
  {
    ignores: ['**/out-tsc'],
  },
  // Last: the React preset above replaces `no-restricted-syntax` (ADR 0013).
  mechanismsDoNotLog,
];
