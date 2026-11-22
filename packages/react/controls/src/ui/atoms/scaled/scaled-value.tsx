import { formatScaled } from '@entifix/core';

export interface ScaledValueProps {
  /** The stored integer. */
  value: number;
  scale: number;
  /** The unit as the reader names it. */
  unit?: string;
  locale: string;
}

/**
 * A scaled integer as a person reads it — `3,5 m`, never `3500` — with
 * tabular figures and its unit kept on the same line. Server-safe.
 */
export function ScaledValue({ value, scale, unit, locale }: ScaledValueProps) {
  const number = formatScaled(value, scale, locale);
  return (
    <span className="whitespace-nowrap tabular-nums">
      {unit === undefined ? number : `${number}\u00a0${unit}`}
    </span>
  );
}
