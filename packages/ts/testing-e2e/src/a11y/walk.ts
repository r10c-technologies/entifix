/**
 * The deterministic part of what axe cannot see, as data: the stops a Tab walk
 * visited, judged against focus order, a visible indicator and nothing
 * covering the focused control (WCAG 2.4.1, 2.4.3, 2.4.7 and 2.4.11).
 */

/**
 * Where a stop sits in the content it scrolls with, in CSS pixels — inside
 * its nearest scrolling container, or the document — so two stops read before
 * and after that container scrolled can be compared.
 */
export interface FocusRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One element focus rested on during the walk. */
export interface FocusStop {
  /** A short description for the failure message: tag, role and name. */
  readonly label: string;
  readonly rect: FocusRect;
  /**
   * The content `rect` is measured in: the nearest scrolling ancestor, or
   * `document`. Positions in two different contents are not comparable, so
   * visual order is only judged between stops that share one.
   */
  readonly container: string;
  readonly inMain: boolean;
  /** An in-page link to `main`, or to something inside it. */
  readonly isSkipLink: boolean;
  /** An outline or a ring could be seen once the focus transition settled. */
  readonly indicatorVisible: boolean;
  /** Entirely hidden: no sampled point of the stop shows the stop (2.4.11). */
  readonly obscured: boolean;
}

/** A walk's stops: from the top, and after activating the skip link. */
export interface FocusWalk {
  readonly stops: readonly FocusStop[];
  /** Present when the walk activated a skip link and kept going. */
  readonly afterSkip?: readonly FocusStop[];
}

export interface WalkExpectations {
  /** The first stop must be a skip link, and activating it must reach `main`. */
  readonly skipLink: boolean;
  /**
   * The highest 1-based position the first stop inside `main` may have —
   * counted after the skip link when there is one, from the top otherwise.
   */
  readonly mainIndexMax: number;
}

const describe = (stop: FocusStop, position: number) =>
  `stop ${position} (${stop.label})`;

/** The stops are in an order a sighted keyboard user can follow (2.4.3). */
const outOfOrder = (stops: readonly FocusStop[]): string[] =>
  stops.slice(1).flatMap((stop, index) => {
    const previous = stops[index] as FocusStop;
    if (stop.container !== previous.container) return [];
    const sameColumn =
      stop.rect.x < previous.rect.x + previous.rect.width &&
      previous.rect.x < stop.rect.x + stop.rect.width;
    const rowAbove = stop.rect.y + stop.rect.height <= previous.rect.y;
    const moreThanARow = stop.rect.y < previous.rect.y - previous.rect.height;
    return sameColumn && rowAbove && moreThanARow
      ? [
          `${describe(stop, index + 2)} sits more than a row above ${describe(previous, index + 1)} in the same column`,
        ]
      : [];
  });

/** Every failure the walk shows, one message per failure; empty is a pass. */
export const assessWalk = (
  walk: FocusWalk,
  expectations: WalkExpectations,
): string[] => {
  const failures: string[] = [];
  const first = walk.stops[0];

  if (first === undefined) {
    return ['the walk reached no focusable element'];
  }

  let counted = walk.stops;
  if (expectations.skipLink) {
    if (!first.isSkipLink) {
      failures.push(`the first stop is ${first.label}, not a skip link`);
    } else if (walk.afterSkip === undefined) {
      failures.push('the skip link was found but not activated');
    } else {
      counted = walk.afterSkip;
    }
  }

  const mainAt = counted.findIndex(stop => stop.inMain) + 1;
  if (mainAt === 0) {
    failures.push(`no stop inside main in the first ${counted.length}`);
  } else if (mainAt > expectations.mainIndexMax) {
    failures.push(
      `the first stop inside main is number ${mainAt}, over the limit of ${expectations.mainIndexMax}`,
    );
  }

  walk.stops.forEach((stop, index) => {
    if (!stop.indicatorVisible) {
      failures.push(`${describe(stop, index + 1)} shows no focus indicator`);
    }
    if (stop.obscured) {
      failures.push(
        `${describe(stop, index + 1)} is covered by another element`,
      );
    }
  });

  return [...failures, ...outOfOrder(walk.stops)];
};
