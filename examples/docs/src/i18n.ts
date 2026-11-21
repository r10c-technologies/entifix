import { defineLocales } from '@entifix/core';
import { defineCatalogs } from '@entifix/i18n';
import {
  controlsCatalogs,
  type ControlsResources,
} from '@entifix/react-controls';
// Load-bearing though it imports nothing: a `declare module` resolves from this
// file's directory, so `i18next` must be a dependency of this application.
import type {} from 'i18next';

/**
 * A docs site needs one namespace: the controls catalog, whose `docs` block
 * holds every string fumadocs shows. Imported from both the layout and the
 * providers, because a Next app's server and client bundles share no module
 * state.
 */
declare module '@entifix/core' {
  interface LocaleRegister {
    locale: 'en';
  }
}
defineLocales({ locales: ['en'], defaultLocale: 'en' });

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'controls';
    resources: ControlsResources;
  }
}

defineCatalogs({
  resources: { en: controlsCatalogs.en, es: controlsCatalogs.es },
  namespaces: ['controls'],
  defaultNS: 'controls',
});

export const LOCALE = 'en' as const;
