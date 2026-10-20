/**
 * Kept as its own entry point for the reason it always was: Next middleware runs
 * on the edge, and importing this package's barrel would pull the i18next
 * runtime into a bundle that only reads a cookie and a header.
 *
 * What changed is where the implementation lives. Locale routing carries no
 * catalogs and no i18next, so it belongs in `@entifix/core` — which is what
 * makes a middleware bundle free of this package entirely.
 */
export {
  defaultLocale,
  defineLocales,
  isLocale,
  type Locale,
  LOCALE_COOKIE,
  LOCALE_HEADER,
  type LocaleDefinition,
  localeHref,
  type LocalePath,
  locales,
  negotiateLocale,
  type NegotiateLocaleInput,
  parseAcceptLanguage,
  splitLocalePath,
} from '@entifix/core';
