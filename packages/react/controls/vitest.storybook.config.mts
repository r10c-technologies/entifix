import * as path from 'node:path';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

/**
 * Every story, rendered in Chromium through `@storybook/addon-vitest`. A story
 * that throws, or that renders nothing into `#storybook-root`, fails the run —
 * `build-storybook` only proves the bundle compiled.
 */
export default defineConfig({
  root,
  cacheDir: path.join(root, '../../../node_modules/.vite/storybook-controls'),
  plugins: [storybookTest({ configDir: path.join(root, '.storybook') })],
  test: {
    name: '@entifix/react-controls:stories',
    watch: false,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
});
