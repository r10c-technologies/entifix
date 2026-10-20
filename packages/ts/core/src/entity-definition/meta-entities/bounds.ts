import { EntifixBuildError } from '../../base-entities/entifix-error/index.js';

const isCount = (value: number | undefined) =>
  value === undefined || (Number.isInteger(value) && value >= 0);

/**
 * A count option that cannot be honoured is a declaration error, thrown when
 * the class is decorated rather than the first time a set of records is
 * checked.
 */
export function assertBounds(
  owner: string,
  bounds: { readonly min?: number; readonly max?: number } | undefined,
): void {
  if (bounds === undefined) return;
  if (!isCount(bounds.min) || !isCount(bounds.max)) {
    throw new EntifixBuildError(
      `${owner} declares a count that is not a whole number of zero or more.`,
    );
  }
  if (
    bounds.min !== undefined &&
    bounds.max !== undefined &&
    bounds.min > bounds.max
  ) {
    throw new EntifixBuildError(
      `${owner} declares a minimum of ${bounds.min} above its maximum of ${bounds.max}.`,
    );
  }
}
