import * as path from 'node:path';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import {
  defineConfig,
  type TestProjectInlineConfiguration,
} from 'vitest/config';

const root = import.meta.dirname;

/**
 * The cells every story is rendered and audited in: each shipped palette, and
 * both scales with the denser of the two densities where the scale has one.
 * Density changed no axe result in the 2026-11-05 baseline, so the matrix
 * pairs it with `fixed` rather than doubling every cell (ADR 0024).
 */
const CELLS = {
  'aurora-fluid': { theme: 'Aurora', scale: 'fluid', density: 'comfortable' },
  'aurora-fixed-compact': {
    theme: 'Aurora',
    scale: 'fixed',
    density: 'compact',
  },
  'midnight-fluid': {
    theme: 'Midnight',
    scale: 'fluid',
    density: 'comfortable',
  },
  'midnight-fixed-compact': {
    theme: 'Midnight',
    scale: 'fixed',
    density: 'compact',
  },
  'sunset-fixed': { theme: 'Sunset', scale: 'fixed', density: 'comfortable' },
} as const;

const cell = (name: keyof typeof CELLS): TestProjectInlineConfiguration => ({
  extends: true,
  plugins: [storybookTest({ configDir: path.join(root, '.storybook') })],
  // Read by `.storybook/preview.ts` as its `initialGlobals`.
  define: {
    'import.meta.env.STORYBOOK_A11Y_CELL': JSON.stringify(CELLS[name]),
  },
  test: {
    name,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
});

/**
 * Every story, rendered in Chromium through `@storybook/addon-vitest` and
 * audited by `@storybook/addon-a11y`, once per cell. A story that throws,
 * renders nothing, or raises a WCAG 2.2 AA violation fails the run, unless
 * its title is on `a11y-todo.json` with the issue that removes it.
 */
export default defineConfig({
  root,
  cacheDir: path.join(root, '../../../node_modules/.vite/storybook-controls'),
  test: {
    watch: false,
    reporters: [
      'default',
      [
        path.join(root, '.storybook/a11y-todo-reporter.ts'),
        { cells: Object.keys(CELLS) },
      ],
    ],
    projects: (Object.keys(CELLS) as (keyof typeof CELLS)[]).map(cell),
  },
});
