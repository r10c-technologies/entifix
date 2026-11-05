// `readStop` and the blur helpers are serialized by `page.evaluate` and run in
// the browser, so this file is checked against the DOM's types as well.
/// <reference lib="dom" />
import { expect, type Page } from '@playwright/test';

import {
  assessWalk,
  type FocusStop,
  type FocusWalk,
  type WalkExpectations,
} from './walk.js';

export interface WalkOptions extends Partial<WalkExpectations> {
  /** How many Tab presses to make before giving up on reaching the end. */
  readonly maxStops?: number;
}

/**
 * A focus ring animates in, and WCAG judges the settled state: each stop is
 * read once every running transition has finished, and never sooner than
 * `SETTLE_MS` after the focus moved.
 */
const SETTLE_MS = 200;

/** Resolves once the page's animations and transitions have finished. */
const settled = async (page: Page) => {
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

/** Reads the focused element in the page. Runs in the browser. */
const readStop = (): FocusStop | null => {
  const element = document.activeElement as HTMLElement | null;
  if (element === null || element === document.body) return null;

  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const outline =
    style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
  const ring = style.boxShadow !== 'none' && style.boxShadow !== '';

  const centre = document.elementFromPoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  const obscured =
    rect.width > 0 &&
    rect.height > 0 &&
    centre !== null &&
    !element.contains(centre) &&
    !centre.contains(element);

  const href = element.getAttribute('href');
  const target =
    href?.startsWith('#') && href.length > 1
      ? document.getElementById(href.slice(1))
      : null;
  const main = document.querySelector('main');
  const isSkipLink =
    element.tagName === 'A' &&
    target !== null &&
    main !== null &&
    (target === main || main.contains(target));

  const name =
    element.getAttribute('aria-label') ??
    element.textContent?.trim().slice(0, 40) ??
    '';
  const role = element.getAttribute('role');
  return {
    label: `${element.tagName.toLowerCase()}${role ? `[role=${role}]` : ''} "${name}"`,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    inMain: element.closest('main') !== null,
    isSkipLink,
    indicatorVisible: outline || ring,
    obscured,
  };
};

const tabThrough = async (page: Page, maxStops: number) => {
  const stops: FocusStop[] = [];
  let first: string | undefined;
  for (let pressed = 0; pressed < maxStops; pressed += 1) {
    await page.keyboard.press('Tab');
    await settled(page);
    const stop = await page.evaluate(readStop);
    if (stop === null) break;
    const identity = `${stop.label}@${stop.rect.x},${stop.rect.y}`;
    // Focus wrapped back to where it started: the walk is complete.
    if (identity === first) break;
    first ??= identity;
    stops.push(stop);
  }
  return stops;
};

/**
 * Tabs through the page from the top and fails on what a keyboard user would
 * hit (ADR 0024): no skip link first when `skipLink` is set, the first stop
 * inside `main` past `mainIndexMax`, a stop with no visible indicator, a stop
 * something else covers, and a stop that jumps back more than a row in its
 * column.
 */
export async function walkKeyboard(
  page: Page,
  { maxStops = 120, skipLink = true, mainIndexMax = 3 }: WalkOptions = {},
): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  const stops = await tabThrough(page, maxStops);

  let walk: FocusWalk = { stops };
  if (skipLink && stops[0]?.isSkipLink === true) {
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    walk = { stops, afterSkip: await tabThrough(page, maxStops) };
  }

  expect(assessWalk(walk, { skipLink, mainIndexMax })).toEqual([]);
}

export interface FocusKeptOptions {
  /**
   * The issue that stops this write dropping focus, while it still does. The
   * check then expects focus on `<body>` and fails once it is not, so the fix
   * has to delete the option — the same ratchet as an axe baseline entry.
   */
  readonly lostUntil?: string;
}

/**
 * After a write — a save, a delete, a submitted step — focus must land on
 * something, not fall back to the document, where a screen reader loses its
 * place and the next Tab starts from the top (2.4.3).
 */
export async function expectFocusKept(
  page: Page,
  { lostUntil }: FocusKeptOptions = {},
): Promise<void> {
  await settled(page);
  const kept = await page.evaluate(
    () =>
      document.activeElement !== null &&
      document.activeElement !== document.body,
  );
  if (lostUntil === undefined) {
    expect(kept, 'focus fell back to <body> after the write').toBe(true);
  } else {
    expect(
      kept,
      `focus is kept after this write now: delete the lostUntil for ${lostUntil}`,
    ).toBe(false);
  }
}
