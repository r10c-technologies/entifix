import type { StorybookConfig } from '@storybook/react-vite';

import { swcTransform } from '../../../../vitest.shared.mjs';

/**
 * Storybook for the agnostic design-system components. It reproduces the app
 * runtime so stories render exactly like production:
 *  - the Tailwind v4 CSS-first pipeline (see `preview.css` + `postcss.config.cjs`),
 *  - the `@entifix/source` resolution condition so workspace packages resolve to
 *    their TypeScript `src` (a single `MetaEntity` registry, no prior build),
 *  - the SWC pass every Vitest project runs (`swcTransform` in
 *    `vitest.shared.mts`).
 *
 * Stories **do** instantiate decorated entities — `EntityTable`, `EntityForm`,
 * `EntityDetailGrid` and `EntityLinkInput` build themselves from metadata, so
 * there is no way to show them without one. Vite 8 transforms TypeScript with
 * oxc, which leaves stage-3 decorators raw: without the SWC pass every such
 * story threw `SyntaxError: Invalid or unexpected token` and rendered an empty
 * root while `build-storybook` stayed green. A green build proves nothing about
 * a story, so `test-a11y` renders every one of them in a browser.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(ts|tsx)'],
  addons: [
    '@storybook/addon-docs',
    '@storybook/addon-themes',
    '@storybook/addon-a11y',
    '@storybook/addon-vitest',
  ],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  viteFinal: viteConfig => {
    viteConfig.resolve ??= {};
    viteConfig.resolve.conditions = [
      '@entifix/source',
      ...(viteConfig.resolve.conditions ?? [
        'browser',
        'module',
        'import',
        'default',
      ]),
    ];
    viteConfig.plugins = [swcTransform(), ...(viteConfig.plugins ?? [])];
    return viteConfig;
  },
};

export default config;
