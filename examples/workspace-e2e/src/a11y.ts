import { join } from 'node:path';

import {
  expectFocusKept,
  expectNoNewA11yViolations,
  walkKeyboard,
  type WalkOptions,
} from '@entifix/testing-e2e/a11y';
import type { Page } from '@playwright/test';

/**
 * Every screen's accepted violations, each against the entifix issue that
 * removes it. `A11Y_BASELINE=update pnpm nx e2e @entifix/example-workspace-e2e`
 * rewrites it; a new entry then has an empty owner, which the spec beside it
 * refuses until one is named.
 */
export const BASELINE = join(__dirname, 'a11y-baseline.json');

/**
 * The keyboard walk's limits, at their defaults (ADR 0024): the skip link is
 * the first stop, and the first stop inside `main` after it is within three.
 */
export const WALK: WalkOptions = {};

/** The screen gate: axe against the baseline, then the keyboard walk. */
export const expectAccessible = async (page: Page, screen: string) => {
  await expectNoNewA11yViolations(page, { screen, baselinePath: BASELINE });
  await walkKeyboard(page, WALK);
};

/** Axe alone, for an open overlay, where a Tab walk stays inside the trap. */
export const expectNoNewViolations = (page: Page, screen: string) =>
  expectNoNewA11yViolations(page, { screen, baselinePath: BASELINE });

export { expectFocusKept };
