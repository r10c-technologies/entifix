import type { ScaledFormat } from '@entifix/core';

/** The scale a record's value is in, and the unit that decided it. */
export interface ResolvedScale {
  readonly scale: number;
  readonly unit?: string;
}

/**
 * How many decimals a member holds in this record: the fixed scale, or its
 * unit's. `undefined` while the record names no unit the member declares,
 * because an integer cannot be read without one.
 */
export function scaleOf(
  scaled: ScaledFormat,
  record: Readonly<Record<string, unknown>> | undefined,
): ResolvedScale | undefined {
  if (scaled.units === undefined) return { scale: scaled.scale };
  const unit = record?.[scaled.unitMember];
  if (typeof unit !== 'string' || !Object.hasOwn(scaled.units, unit))
    return undefined;
  return { scale: scaled.units[unit] as number, unit };
}
