import { join } from 'node:path';

import { baseTest } from '@entifix/testing-e2e/playwright';
import { expect, type Page } from '@playwright/test';

export const test = baseTest;
export { expect };

/** The site's base path, as `examples/docs/next.config.js` sets it. */
export const BASE = '/docs';

export const BASELINE = join(__dirname, 'a11y-baseline.json');

/** The palettes the site offers, and the widths the gate measures at. */
export const THEMES = ['aurora', 'midnight'] as const;
export const WIDTHS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

/**
 * A guide, a record with code and tables, the guide with a code block, and the
 * package reference's index and one package.
 */
export const PAGES = [
  '/guides/',
  '/records/0031/',
  '/guides/adopting/',
  '/packages/',
  '/packages/sql/',
];

/**
 * Opens a page in a palette, the way a returning reader arrives: the choice in
 * the cookie, painted by the theme script before React loads.
 */
export const openIn = async (page: Page, path: string, theme: string) => {
  await page
    .context()
    .addCookies([
      { name: 'entifix-theme', value: theme, url: 'http://localhost:3210' },
    ]);
  page.on('pageerror', error => {
    throw error;
  });
  await page.goto(`${BASE}${path}`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
};

/**
 * The contrast ratio between two CSS colours, resolved by the browser itself:
 * each is painted onto a canvas and read back as sRGB, so `color-mix()`,
 * `oklch()` and custom properties resolve exactly as they render.
 */
export const contrastOf = (
  page: Page,
  foreground: string,
  background: string,
) =>
  page.evaluate(
    ([fg, bg]) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('no canvas');
      const rgb = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = '#fff';
        context.fillRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      };
      const luminance = (color: string) => {
        const [r, g, b] = rgb(color).map(channel => {
          const c = channel / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        }) as [number, number, number];
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [
        number,
        number,
      ];
      return (a + 0.05) / (b + 0.05);
    },
    [foreground, background] as const,
  );
