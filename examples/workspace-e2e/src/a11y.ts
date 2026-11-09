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
 * The keyboard walk's limits, ratcheted like the baseline (ADR 0024). The
 * shell has no skip link yet and the sidebar comes before `main`, so the walk
 * counts raw stops; r10c-technologies/entifix#199 adds the skip link and one
 * Tab stop per navigation group, and tightens both to the targets. Each nav
 * item costs three stops until then, so the Payments list raised it to 13.
 */
export const WALK: WalkOptions = { skipLink: false, mainIndexMax: 13 };

/** The screen gate: axe against the baseline, then the keyboard walk. */
export const expectAccessible = async (page: Page, screen: string) => {
  await expectNoNewA11yViolations(page, { screen, baselinePath: BASELINE });
  await walkKeyboard(page, WALK);
};

/** Axe alone, for an open overlay, where a Tab walk stays inside the trap. */
export const expectNoNewViolations = (page: Page, screen: string) =>
  expectNoNewA11yViolations(page, { screen, baselinePath: BASELINE });

export { expectFocusKept };
