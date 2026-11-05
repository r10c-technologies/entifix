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
 * Tab stop per navigation group, and tightens both to the targets.
 */
export const WALK: WalkOptions = { skipLink: false, mainIndexMax: 10 };

/**
 * A generated form drops focus to `<body>` after it saves or hands off, so a
 * write that does is marked with this until r10c-technologies/entifix#194
 * moves focus to the region's heading.
 */
export const LOST_UNTIL = 'r10c-technologies/entifix#194';

/** The screen gate: axe against the baseline, then the keyboard walk. */
export const expectAccessible = async (page: Page, screen: string) => {
  await expectNoNewA11yViolations(page, { screen, baselinePath: BASELINE });
  await walkKeyboard(page, WALK);
};

/** Axe alone, for an open overlay, where a Tab walk stays inside the trap. */
export const expectNoNewViolations = (page: Page, screen: string) =>
  expectNoNewA11yViolations(page, { screen, baselinePath: BASELINE });

export { expectFocusKept };
