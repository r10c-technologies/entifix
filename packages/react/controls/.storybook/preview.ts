import './preview.css';
import './catalogs.js';

import { type Locale, locales } from '@entifix/core';
import { withThemeByDataAttribute } from '@storybook/addon-themes';
import type { Preview } from '@storybook/react-vite';
import { createElement } from 'react';

import todo from '../a11y-todo.json' with { type: 'json' };
import { I18nProvider } from '../src/i18next/index.js';
import { enterGateEnvironment, type GateEnvironment } from './gate-browser.js';
import { targetMin, undersizedTargets } from './target-size.js';

/**
 * The WCAG 2.2 AA rule tags axe runs, and nothing else (ADR 0024). `wcag21a`
 * is in the list because the A-level 2.1 criteria are part of AA conformance.
 */
const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * The cell the Vitest project renders in, set by `vitest.storybook.config.mts`;
 * absent in `storybook dev`, where the toolbar chooses.
 */
const CELL = import.meta.env['STORYBOOK_A11Y_CELL'] as
  { theme: string; scale: string; density: string } | undefined;

/** Story titles with a known violation, each owned by the issue that fixes it. */
const TODO: Readonly<Record<string, string>> = todo;

const preview: Preview = {
  parameters: {
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
    layout: 'centered',
    backgrounds: { disable: true },
    a11y: {
      // A violation fails the story — in `test-a11y`, and in the panel.
      test: 'error',
      options: { runOnly: { type: 'tag', values: WCAG_22_AA } },
      config: {
        rules: [
          // Headless UI's focus sentinels are `aria-hidden` spans that take
          // focus only to hand it back to the trap they guard, so a keyboard
          // never rests on one. Every other node is still checked.
          {
            id: 'aria-hidden-focus',
            selector:
              '[aria-hidden="true"]:not([id^="headlessui-focus-sentinel"])',
          },
        ],
      },
    },
  },
  // A story that renders nothing passes every other check vacuously — the
  // decorator bug that blanked the entity stories did exactly that — so an
  // empty root fails the story wherever it runs.
  //
  // At fixed + compact, the smallest any control is painted, every target's
  // hit area must reach `--target-min` (ADR 0025, `target-size.ts`).
  afterEach: ({ canvasElement, title, name }) => {
    if (!canvasElement.hasChildNodes()) {
      throw new Error(`${title} › ${name} rendered nothing into its root.`);
    }
    if (
      CELL?.scale === 'fixed' &&
      CELL.density === 'compact' &&
      TODO[title] === undefined
    ) {
      const body = canvasElement.ownerDocument.body;
      const undersized = undersizedTargets(body, targetMin(body));
      if (undersized.length > 0) {
        throw new Error(
          `${title} › ${name}: targets under --target-min at fixed + compact:\n  ${undersized.join('\n  ')}`,
        );
      }
    }
  },
  // A listed title still renders and is still audited; its violations are
  // reported instead of failing it, until its issue lands and removes it.
  //
  // A story that needs a particular browser — a viewport, forced colours —
  // declares it as `parameters.gate`, and it is entered before the story
  // renders and left after it, so it never leaks into the next story.
  beforeEach: async ({ title, parameters }) => {
    if (TODO[title] !== undefined) {
      parameters['a11y'] = { ...parameters['a11y'], test: 'todo' };
    }
    return enterGateEnvironment(
      (parameters['gate'] as GateEnvironment | undefined) ?? {},
    );
  },
  initialGlobals: {
    locale: 'es',
    scale: CELL?.scale ?? 'fluid',
    density: CELL?.density ?? 'comfortable',
    ...(CELL === undefined ? {} : { theme: CELL.theme }),
  },
  globalTypes: {
    locale: {
      description: 'Locale',
      toolbar: {
        icon: 'globe',
        items: [...locales()],
        dynamicTitle: true,
      },
    },
    scale: {
      description: 'Type and spacing scale',
      toolbar: { icon: 'ruler', items: ['fluid', 'fixed'], dynamicTitle: true },
    },
    density: {
      description: 'Density',
      toolbar: {
        icon: 'component',
        items: ['comfortable', 'compact'],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    // On <html>, as an app sets them: the fixed scale and its density swap the
    // spacing tokens for the whole document, overlays included.
    (Story, context) => {
      const root = document.documentElement;
      if (context.globals['scale'] === 'fixed') root.dataset['scale'] = 'fixed';
      else delete root.dataset['scale'];
      root.dataset['density'] = String(context.globals['density']);
      return createElement(Story);
    },
    // Every control resolves its copy through the provider, so a story without
    // one would exercise the fallback rather than the real path. The toolbar
    // puts the second locale one click away — which is where a caption that
    // outgrew its button gets noticed.
    (Story, context) =>
      createElement(
        I18nProvider,
        { locale: context.globals['locale'] as Locale },
        createElement(Story),
      ),
    // Flip the `data-theme` attribute on <html> from the toolbar, exactly how
    // apps switch palettes. Values match the shipped presets.
    withThemeByDataAttribute({
      themes: { Aurora: 'aurora', Sunset: 'sunset', Midnight: 'midnight' },
      defaultTheme: 'Aurora',
      attributeName: 'data-theme',
    }),
  ],
};

export default preview;
