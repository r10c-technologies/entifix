import nx from '@nx/eslint-plugin';
import nextConfig from 'eslint-config-next';
import coreWebVitalsConfig from 'eslint-config-next/core-web-vitals';

import baseConfig, { accessibleJsx } from '../../eslint.config.mjs';

export default [
  ...nextConfig,
  ...coreWebVitalsConfig,
  ...baseConfig,
  ...nx.configs['flat/react-typescript'],
  {
    settings: { react: { version: '19.0.0' } },
  },
  {
    // `out` is the export and `ui` the Storybook copy the build makes.
    ignores: ['.next/**/*', '**/out-tsc', 'next-env.d.ts', 'out/**', 'ui/**'],
  },
  // After the React and Next presets, whose warn-level subsets would win.
  accessibleJsx,
];
