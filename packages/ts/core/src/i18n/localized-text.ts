import { defaultLocale, type Locale } from './locales.js';

/**
 * One fact in every language the host ships — a product description, a job's
 * responsibilities — held as one value with a text per locale:
 * `{ en: 'Tech Lead', es: 'Líder técnico' }`.
 *
 * The value of a member declared `type: 'localized'`. Content, not UI copy:
 * copy belongs in catalogs, and a record written once per locale duplicates
 * every member that is not text and lets the copies drift.
 *
 * `Partial` because a value read off the wire may be missing a locale; what a
 * complete one must carry is checked by `validateRecords` and by the form,
 * against the locales the host declared.
 */
export type LocalizedText = Readonly<Partial<Record<Locale, string>>>;

/**
 * A localized value in the reader's locale, falling back to the host's default
 * when that locale has no text, and `undefined` when neither does.
 *
 * The caller picks the locale — a page from its route, a cell from the
 * provider — so entities hold every locale and stay locale-agnostic. The
 * fallback is defence, not a plan: validated content carries every locale.
 */
export function localize(
  text: LocalizedText | null | undefined,
  locale: Locale,
): string | undefined {
  if (text === null || text === undefined) return undefined;
  const own = text[locale];
  return own !== undefined && own !== '' ? own : text[defaultLocale()];
}

/** Whether a value has the shape of a {@link LocalizedText}: a map of strings. */
export function isLocalizedText(value: unknown): value is LocalizedText {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    Object.values(value).every(text => typeof text === 'string')
  );
}
