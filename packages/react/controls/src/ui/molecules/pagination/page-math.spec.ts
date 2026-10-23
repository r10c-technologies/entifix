import { describe, expect, it } from 'vitest';

import { pageCount, pageWindow } from './page-math.js';

const numbers = (current: number, total: number, radius?: number) =>
  pageWindow(current, total, radius).map(entry =>
    entry.kind === 'page' ? entry.page : '…',
  );

describe('pageCount', () => {
  it('rounds a partial page up', () => {
    expect(pageCount(35, 10)).toBe(4);
  });

  it('is one page for an empty listing', () => {
    expect(pageCount(0, 10)).toBe(1);
  });
});

describe('pageWindow', () => {
  it('shows every page of a short listing', () => {
    expect(numbers(2, 4)).toEqual([1, 2, 3, 4]);
  });

  it('is a single page for a single-page listing', () => {
    expect(numbers(1, 1)).toEqual([1]);
  });

  it('keeps the first and the last, around the current page', () => {
    expect(numbers(10, 20)).toEqual([1, '…', 9, 10, 11, '…', 20]);
  });

  it('widens with the radius', () => {
    expect(numbers(10, 20, 2)).toEqual([1, '…', 8, 9, 10, 11, 12, '…', 20]);
  });

  /** A gap as wide as the number it hides is worse than the number. */
  it('shows a single skipped page instead of a gap', () => {
    expect(numbers(4, 10)).toEqual([1, 2, 3, 4, 5, '…', 10]);
    expect(numbers(7, 10)).toEqual([1, '…', 6, 7, 8, 9, 10]);
  });

  it('stays inside the listing at either edge', () => {
    expect(numbers(1, 10)).toEqual([1, 2, '…', 10]);
    expect(numbers(10, 10)).toEqual([1, '…', 9, 10]);
  });
});
