import type { Locale } from './locales.js';

/**
 * The most decimals a scale can carry and still leave a safe integer room to
 * count with.
 */
export const MAX_SCALE = 15;

const decimalSeparators = new Map<Locale, string>();

/** The character `locale` writes before a fraction. */
function decimalSeparatorOf(locale: Locale): string {
  const known = decimalSeparators.get(locale);
  if (known !== undefined) return known;
  const separator =
    new Intl.NumberFormat(locale)
      .formatToParts(1.5)
      .find(part => part.type === 'decimal')?.value === ','
      ? ','
      : '.';
  decimalSeparators.set(locale, separator);
  return separator;
}

/** Digits grouped in threes by one separator: `1,000`, `12.500.000`. */
const groupedBy = (separator: string) =>
  new RegExp(`^[1-9]\\d{0,2}(?:\\${separator}\\d{3})+$`);

const GROUPED = { ',': groupedBy(','), '.': groupedBy('.') } as const;

/**
 * The whole and fraction digits `text` writes, or `undefined` when it writes
 * no number or could write two.
 */
function digitsOf(
  text: string,
  scale: number,
  locale: Locale,
): readonly [whole: string, fraction: string] | undefined {
  if (!/^[\d.,]+$/.test(text) || !/\d/.test(text)) return undefined;
  const last = Math.max(text.lastIndexOf(','), text.lastIndexOf('.'));
  if (last === -1) return [text, ''];
  const separator = text.charAt(last) as ',' | '.';
  const head = text.slice(0, last);
  const tail = text.slice(last + 1);
  const other = separator === ',' ? '.' : ',';

  // Both separators: the last opens the fraction, the other groups.
  if (head.includes(other)) {
    return GROUPED[other].test(head)
      ? [head.replaceAll(other, ''), tail]
      : undefined;
  }
  // One separator, repeated: it can only be grouping.
  if (head.includes(separator)) {
    return GROUPED[separator].test(text)
      ? [text.replaceAll(separator, ''), '']
      : undefined;
  }
  if (GROUPED[separator].test(text)) {
    // `1,000`: three decimals do not fit, so it can only be a thousand.
    if (scale < 3) return [head + tail, ''];
    // They fit, so it could be either. The reader's own decimal separator is
    // the one this member is shown with; the other one is refused.
    return separator === decimalSeparatorOf(locale) ? [head, tail] : undefined;
  }
  return [head, tail];
}

/**
 * The integer `text` stands for in `scale` decimals — `'3,5'` at scale 3 is
 * `3500` — or `undefined` when it stands for none. Read digit by digit and
 * never through a float.
 *
 * **It never rounds and never guesses.** More decimals than the scale holds is
 * not a number here, and neither is text with two readings:
 *
 * - either separator opens a fraction (`64,99`, `64.99`), because people type
 *   both whatever their locale;
 * - grouping is accepted where it can only be grouping (`1.234,56`,
 *   `12.500.000`, and `1,000` below scale 3);
 * - at scale 3 and over, `1.500` could be fifteen hundred or one and a half:
 *   it is a fraction when `.` is the locale's decimal separator and refused
 *   when it is not.
 */
export function parseScaled(
  text: string,
  scale: number,
  locale: Locale,
): number | undefined {
  const compact = text.replace(/[\s'’]/g, '');
  const sign = /^[+-]/.exec(compact)?.[0] ?? '';
  const digits = digitsOf(compact.slice(sign.length), scale, locale);
  if (digits === undefined) return undefined;
  const [whole, fraction] = digits;
  if (fraction.length > scale) return undefined;
  const magnitude = BigInt(`${whole}${fraction.padEnd(scale, '0')}`);
  if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return magnitude === 0n ? 0 : Number(magnitude) * (sign === '-' ? -1 : 1);
}

/** The plain decimal a scaled integer stands for: `3500` at 3 is `'3.5'`. */
export function scaledToDecimal(value: number, scale: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${String(value)} is not a scaled integer`);
  }
  const digits = String(Math.abs(value)).padStart(scale + 1, '0');
  const at = digits.length - scale;
  const fraction = digits.slice(at).replace(/0+$/, '');
  return `${value < 0 ? '-' : ''}${digits.slice(0, at)}${
    fraction === '' ? '' : `.${fraction}`
  }`;
}

/**
 * A scaled integer as the reader's locale writes it, with no more decimals
 * than it has. With `grouping: false` it is the text to edit: Latin digits in
 * the locale's decimal separator, which `parseScaled` reads back exactly.
 */
export function formatScaled(
  value: number,
  scale: number,
  locale: Locale,
  { grouping = true }: { readonly grouping?: boolean } = {},
): string {
  const decimal = scaledToDecimal(value, scale);
  if (!grouping) return decimal.replace('.', decimalSeparatorOf(locale));
  const fraction = decimal.split('.')[1]?.length ?? 0;
  // `format` takes a decimal string exactly (ES2023), so a long count is never
  // rounded through a float on its way to the screen. The cast is for this
  // package's `lib`, whose typings predate that overload.
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  }).format(decimal as unknown as number);
}
