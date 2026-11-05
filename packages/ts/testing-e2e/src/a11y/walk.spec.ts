import { describe, expect, it } from 'vitest';

import { assessWalk, type FocusStop } from './walk.js';

const stop = (overrides: Partial<FocusStop> = {}): FocusStop => ({
  label: 'a "Home"',
  rect: { x: 0, y: 0, width: 100, height: 20 },
  container: 'document',
  inMain: false,
  isSkipLink: false,
  indicatorVisible: true,
  obscured: false,
  ...overrides,
});

const row = (y: number, overrides: Partial<FocusStop> = {}) =>
  stop({ rect: { x: 0, y, width: 100, height: 20 }, ...overrides });

describe('assessWalk', () => {
  it('passes a page whose skip link reaches main at once', () => {
    expect(
      assessWalk(
        {
          stops: [row(0, { isSkipLink: true, label: 'a "Skip"' }), row(30)],
          afterSkip: [row(200, { inMain: true })],
        },
        { skipLink: true, mainIndexMax: 1 },
      ),
    ).toEqual([]);
  });

  it('refuses a walk that found nothing to focus', () => {
    expect(
      assessWalk({ stops: [] }, { skipLink: false, mainIndexMax: 1 }),
    ).toEqual(['the walk reached no focusable element']);
  });

  it('wants the skip link first, and activated', () => {
    expect(
      assessWalk(
        { stops: [row(0, { inMain: true })] },
        { skipLink: true, mainIndexMax: 5 },
      ),
    ).toEqual(['the first stop is a "Home", not a skip link']);
    expect(
      assessWalk(
        { stops: [row(0, { isSkipLink: true }), row(30, { inMain: true })] },
        { skipLink: true, mainIndexMax: 5 },
      ),
    ).toEqual(['the skip link was found but not activated']);
  });

  it('counts raw stops to main when there is no skip link', () => {
    const stops = [row(0), row(30), row(60, { inMain: true })];
    expect(assessWalk({ stops }, { skipLink: false, mainIndexMax: 3 })).toEqual(
      [],
    );
    expect(assessWalk({ stops }, { skipLink: false, mainIndexMax: 2 })).toEqual(
      ['the first stop inside main is number 3, over the limit of 2'],
    );
    expect(
      assessWalk({ stops: [row(0)] }, { skipLink: false, mainIndexMax: 2 }),
    ).toEqual(['no stop inside main in the first 1']);
  });

  it('names a stop with no indicator and one that is covered', () => {
    expect(
      assessWalk(
        {
          stops: [
            row(0, {
              inMain: true,
              indicatorVisible: false,
              label: 'button "Save"',
            }),
            row(30, { obscured: true, label: 'a "Next"' }),
          ],
        },
        { skipLink: false, mainIndexMax: 1 },
      ),
    ).toEqual([
      'stop 1 (button "Save") shows no focus indicator',
      'stop 2 (a "Next") is covered by another element',
    ]);
  });

  it('refuses a stop more than a row above the previous one in its column', () => {
    const jumpBack = [
      row(0, { inMain: true }),
      row(100, { label: 'a "Down"' }),
      row(40, { label: 'a "Back up"' }),
    ];
    expect(
      assessWalk({ stops: jumpBack }, { skipLink: false, mainIndexMax: 1 }),
    ).toEqual([
      'stop 3 (a "Back up") sits more than a row above stop 2 (a "Down") in the same column',
    ]);
  });

  it('compares positions only within one scrolled content', () => {
    // The last sidebar link sits far down the sidebar's own content; main's
    // first link sits near the top of the document. Neither is above the
    // other in any sense a reader sees.
    const stops = [
      row(900, { container: 'document > aside:1', label: 'a "Link 39"' }),
      row(40, { inMain: true, label: 'a "Main"' }),
    ];
    expect(assessWalk({ stops }, { skipLink: false, mainIndexMax: 2 })).toEqual(
      [],
    );
  });

  it('allows a new column to start higher, and the next line of a row', () => {
    const columns = [
      row(0, { inMain: true }),
      row(100),
      stop({ rect: { x: 300, y: 0, width: 100, height: 20 } }),
      // Directly above by less than one row: the next line of a wrapped row.
      stop({ rect: { x: 300, y: 25, width: 100, height: 20 } }),
      stop({ rect: { x: 300, y: 10, width: 100, height: 20 } }),
    ];
    expect(
      assessWalk({ stops: columns }, { skipLink: false, mainIndexMax: 1 }),
    ).toEqual([]);
  });
});
