// Serialized by `page.evaluate` and run in the browser.
/// <reference lib="dom" />
import type { Page } from '@playwright/test';

/**
 * WCAG judges what is on screen once it has settled. A focus ring animates in,
 * and a palette applied after hydration transitions every colour — axe
 * measuring contrast mid-transition reports a ratio no user ever sees. So a
 * read waits for every finite animation to finish, and never happens sooner
 * than `SETTLE_MS` after whatever moved.
 */
const SETTLE_MS = 200;

/** Resolves once the page's animations and transitions have finished. */
export const settled = async (page: Page) => {
  await page.waitForTimeout(SETTLE_MS);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        // A spinner never finishes; only what eventually settles is awaited.
        .filter(
          animation => animation.effect?.getTiming().iterations !== Infinity,
        )
        .map(animation => animation.finished),
    ),
  );
};
