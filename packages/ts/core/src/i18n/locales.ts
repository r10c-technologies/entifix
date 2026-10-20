import { EntifixBuildError } from '../base-entities/entifix-error/index.js';

/**
 * Where a host narrows {@link Locale} to the locales it ships:
 *
 * ```ts
 * declare module '@entifix/core' {
 *   interface LocaleRegister {
 *     locale: 'es' | 'en';
 *   }
 * }
 * ```
 *
 * The same mechanism i18next's `CustomTypeOptions` uses. Without it a locale is
 * any string, which is honest for a framework that does not know which
 * languages its host speaks.
 */
// An empty interface is the point: a host merges its declaration into it.
// eslint-disable-next-line @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type
export interface LocaleRegister {}

/** A locale the host declared, or any string when it declared none. */
export type Locale = LocaleRegister extends { locale: infer L extends string }
  ? L
  : string;

/** What a host declares through {@link defineLocales}. */
export interface LocaleDefinition {
  /** Every locale the host ships, in the order a switcher offers them. */
  readonly locales: readonly Locale[];
  /**
   * The locale a visitor gets when nothing else decides, and the one a missing
   * catalog key falls back to.
   */
  readonly defaultLocale: Locale;
}

/**
 * What a host gets when it declares nothing: English alone. Neutral rather than
 * any one adopter's choice — r10c, which once supplied the `es` default here,
 * now declares it like everyone else (#35).
 */
const UNDECLARED: LocaleDefinition = {
  locales: ['en' as Locale],
  defaultLocale: 'en' as Locale,
};

let declared: LocaleDefinition = UNDECLARED;

/**
 * Declares the host's locales. Call it once, from a module every entry point
 * imports — including a Next middleware, which is bundled on its own and shares
 * no module state with the server.
 *
 * Read at call time by every helper below and by `@entifix/i18n`,
 * `@entifix/react-controls` and `@entifix/next-i18n`, so a host declaring
 * `['en', 'es']` with `en` first gets English as the fallback everywhere, and a
 * third locale needs no change to entifix.
 */
export function defineLocales(definition: LocaleDefinition): void {
  const { locales: list, defaultLocale: fallback } = definition;
  if (list.length === 0) {
    throw new EntifixBuildError('defineLocales needs at least one locale.');
  }
  const duplicate = list.find(
    (locale, index) => list.indexOf(locale) !== index,
  );
  if (duplicate !== undefined) {
    throw new EntifixBuildError(
      `defineLocales was given "${duplicate}" more than once.`,
    );
  }
  if (!list.includes(fallback)) {
    throw new EntifixBuildError(
      `The default locale "${fallback}" is not one of ${JSON.stringify(list)}.`,
    );
  }
  declared = { locales: [...list], defaultLocale: fallback };
}

/** The locales the host declared. */
export function locales(): readonly Locale[] {
  return declared.locales;
}

/** The host's default locale. */
export function defaultLocale(): Locale {
  return declared.defaultLocale;
}

/** Forgets the host's declaration. For specs. */
export function resetLocales(): void {
  declared = UNDECLARED;
}

/**
 * Host-scoped so the choice is shared across the fleet's localhost ports in dev,
 * exactly like `entifix_at`/`entifix_sid`. Written by the locale middleware on every
 * redirect, so a visitor who lands on `/en/...` keeps English on the next visit.
 */
export const LOCALE_COOKIE = 'entifix_locale';

/**
 * Request header the locale middleware sets when it rewrites a prefixed path.
 * Server components read it instead of a route param, which is what lets the
 * route tree stay free of an `app/[locale]` segment.
 */
export const LOCALE_HEADER = 'x-entifix-locale';

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === 'string' &&
    (declared.locales as readonly string[]).includes(value)
  );
}
