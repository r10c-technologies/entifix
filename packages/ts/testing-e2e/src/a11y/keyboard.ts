// `readStop` and the blur helpers are serialized by `page.evaluate` and run in
// the browser, so this file is checked against the DOM's types as well.
/// <reference lib="dom" />
import { expect, type Page } from '@playwright/test';

import { settled } from './settle.js';
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

/** Reads the focused element in the page. Runs in the browser. */
const readStop = (): FocusStop | null => {
  const element = document.activeElement as HTMLElement | null;
  if (element === null || element === document.body) return null;

  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);

  // Where the stop sits in the content it scrolls with, not in the viewport:
  // focusing a stop scrolls its container, so viewport positions taken at
  // different stops are not comparable — a sidebar link further down read as
  // a row *above* the one before it once the sidebar had scrolled. The nearest
  // scrolling ancestor names the content, and the position is taken inside it.
  let scroller: HTMLElement | null = element.parentElement;
  while (
    scroller !== null &&
    scroller !== document.body &&
    !(
      /auto|scroll/.test(getComputedStyle(scroller).overflowY) &&
      scroller.scrollHeight > scroller.clientHeight
    )
  ) {
    scroller = scroller.parentElement;
  }
  if (scroller === document.body) scroller = null;
  const origin =
    scroller === null
      ? { x: -window.scrollX, y: -window.scrollY }
      : (() => {
          const box = scroller.getBoundingClientRect();
          return {
            x: box.x - scroller.scrollLeft,
            y: box.y - scroller.scrollTop,
          };
        })();
  const path = (node: Element | null): string =>
    node === null
      ? 'document'
      : `${path(node.parentElement === document.documentElement ? null : node.parentElement)} > ${node.tagName.toLowerCase()}:${[...(node.parentElement?.children ?? [])].indexOf(node)}`;

  const outline =
    style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
  const ring = style.boxShadow !== 'none' && style.boxShadow !== '';

  // WCAG 2.4.11 (AA) fails a focused control only when it is entirely hidden,
  // so the stop is covered when no sampled point of it — the centre and four
  // points just inside its corners — shows the element itself.
  const inset = Math.min(2, rect.width / 2, rect.height / 2);
  const points = [
    [rect.x + rect.width / 2, rect.y + rect.height / 2],
    [rect.x + inset, rect.y + inset],
    [rect.x + rect.width - inset, rect.y + inset],
    [rect.x + inset, rect.y + rect.height - inset],
    [rect.x + rect.width - inset, rect.y + rect.height - inset],
  ] as const;
  const obscured =
    rect.width > 0 &&
    rect.height > 0 &&
    points.every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return hit === null || (!element.contains(hit) && !hit.contains(element));
    });

  // The visible `main`, and the visible element an in-page link names: a
  // router that keeps the previous page mounted but hidden (React's
  // `<Activity>`) leaves two of each in the document, and the first in
  // document order may be the hidden one.
  const visible = (candidates: Iterable<Element>) =>
    [...candidates].find(candidate => candidate.checkVisibility()) ?? null;
  const href = element.getAttribute('href');
  const target =
    href?.startsWith('#') && href.length > 1
      ? visible(
          document.querySelectorAll(`[id="${CSS.escape(href.slice(1))}"]`),
        )
      : null;
  const main = visible(document.querySelectorAll('main'));
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
    rect: {
      x: rect.x - origin.x,
      y: rect.y - origin.y,
      width: rect.width,
      height: rect.height,
    },
    container: path(scroller),
    inMain: main !== null && main.contains(element),
    isSkipLink,
    indicatorVisible: outline || ring,
    obscured,
  };
};

/** The id of the walk's starting point, so it can be removed afterwards. */
const WALK_START = 'entifix-a11y-walk-start';

/**
 * Puts the browser's sequential focus starting point at the top of the
 * document. Blurring is not enough: after a form posts and redirects, or a
 * control was clicked, the next Tab starts from where that happened, and a
 * walk from there skipped the whole header — or found nothing. A script-only
 * focusable element first in `<body>` is focused instead; `tabIndex = -1`
 * keeps it out of the walk itself.
 */
const fromTheTop = (page: Page) =>
  page.evaluate(id => {
    window.scrollTo(0, 0);
    let start = document.getElementById(id);
    if (start === null) {
      start = document.createElement('span');
      start.id = id;
      start.tabIndex = -1;
      document.body.prepend(start);
    }
    start.focus({ preventScroll: true });
  }, WALK_START);

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
  await fromTheTop(page);
  const stops = await tabThrough(page, maxStops);

  let walk: FocusWalk = { stops };
  if (skipLink && stops[0]?.isSkipLink === true) {
    await fromTheTop(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    walk = { stops, afterSkip: await tabThrough(page, maxStops) };
  }

  await page.evaluate(id => document.getElementById(id)?.remove(), WALK_START);
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
