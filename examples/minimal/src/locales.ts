import { defineLocales } from '@entifix/core';

/**
 * The locales this host ships, Spanish first and by default.
 *
 * entifix assumes none of its own: what a host speaks is the host's value, the
 * same as its catalogs. The augmentation narrows `Locale` from any string to
 * these two, so a typo in a `localeHref` is a compile error.
 *
 * ⚠️ Imported from **both** `i18n.ts` and `middleware.ts`. The middleware is
 * bundled for the edge on its own and shares no module state with the server, so
 * a declaration it never imports leaves it routing by entifix's English-only
 * default.
 */
declare module '@entifix/core' {
  interface LocaleRegister {
    locale: 'es' | 'en';
  }
}

defineLocales({ locales: ['es', 'en'], defaultLocale: 'es' });
