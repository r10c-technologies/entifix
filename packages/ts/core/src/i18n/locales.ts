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
  /**
   * The conventions each locale formats numbers, money and dates in, where
   * they are not the language's own: `{ es: 'es-GT' }` writes `64.99` where
   * `es` writes `64,99`. Catalogs, routing and the cookie keep the locale.
   *
   * Left out, what was declared before stands for the locales still listed,
   * so a second declaration of the same locales cannot undo it; `{}` clears it.
   */
  readonly formattingLocales?: Readonly<Partial<Record<Locale, string>>>;
}

/**
 * What a host gets when it declares nothing: English alone. Neutral rather than
 * any one adopter's choice — the adopter that once supplied the `es` default
 * here now declares it like everyone else (#35).
 */
const UNDECLARED: LocaleDefinition = {
  locales: ['en' as Locale],
  defaultLocale: 'en' as Locale,
};

let declared: LocaleDefinition = UNDECLARED;
let formatting: ReadonlyMap<string, string> = new Map();

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
  const {
    locales: list,
    defaultLocale: fallback,
    formattingLocales,
  } = definition;
  if (list.length === 0) {
    throw new Error('defineLocales needs at least one locale.');
  }
  const duplicate = list.find(
    (locale, index) => list.indexOf(locale) !== index,
  );
  if (duplicate !== undefined) {
    throw new Error(`defineLocales was given "${duplicate}" more than once.`);
  }
  if (!list.includes(fallback)) {
    throw new Error(
      `The default locale "${fallback}" is not one of ${JSON.stringify(list)}.`,
    );
  }
  const next = new Map(
    formattingLocales === undefined
      ? [...formatting].filter(([locale]) => list.includes(locale as Locale))
      : (Object.entries(formattingLocales) as [string, string][]),
  );
  for (const [locale, tag] of next) {
    if (!list.includes(locale as Locale)) {
      throw new Error(
        `The formatting locale's key "${locale}" is not one of ${JSON.stringify(list)}.`,
      );
    }
    // A tag without data formats as the runtime's own locale, which is a
    // different one on the server and in the browser.
    if (Intl.NumberFormat.supportedLocalesOf(tag).length === 0) {
      throw new Error(`Intl has no formats for the locale "${tag}".`);
    }
  }
  formatting = next;
  declared = { locales: [...list], defaultLocale: fallback };
}

/**
 * The tag to hand `Intl` for `locale`: the one the host declared in
 * `formattingLocales`, or the locale itself. Every formatter and parser here
 * asks it, so a caller passes the locale it renders in and nothing else.
 */
export function formattingLocale(locale: string): string {
  return formatting.get(locale) ?? locale;
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
  formatting = new Map();
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
