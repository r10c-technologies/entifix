import { defineCatalogs } from '@entifix/i18n';
import { shellCatalogs, type ShellResources } from '@entifix/next-shell';
import {
  controlsCatalogs,
  type ControlsResources,
  registerFallbackCatalog,
} from '@entifix/react-controls';

import { en } from './catalogs/en';
import { es, type ExampleCatalog } from './catalogs/es';

/**
 * The file every adopter writes first — the README's "The first thing you have
 * to write", made real.
 *
 * The framework ships the copy for what *it* renders (`controls`, `shell`); this
 * host adds its own (`entity`, `errors`, `app`) and composes the one typed-key
 * shape, because TypeScript allows a single `declare module 'i18next'` per
 * compilation.
 *
 * ⚠️ Imported from **both** `app/layout.tsx` and `app/providers.tsx`. A Next
 * app's server and client are separate bundles with separate module state, so
 * installing from the provider alone leaves every server render throwing
 * `No i18n catalogs are installed`.
 */
export const RESOURCES = {
  es: { ...controlsCatalogs.es, ...shellCatalogs.es, ...es },
  en: { ...controlsCatalogs.en, ...shellCatalogs.en, ...en },
} as const;

export type Resources = ControlsResources & ShellResources & ExampleCatalog;

export const NAMESPACES = [
  'controls',
  'shell',
  'entity',
  'errors',
  'app',
] as const satisfies ReadonlyArray<keyof Resources>;

// Load-bearing though it imports nothing: a `declare module` resolves from this
// file's directory, so `i18next` must be a dependency of this application.
import type {} from 'i18next';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'controls';
    resources: Resources;
  }
}

defineCatalogs({
  resources: RESOURCES,
  namespaces: NAMESPACES,
  defaultNS: 'controls',
});

// And for a component rendered outside the provider, the same host namespaces.
for (const namespace of ['entity', 'errors', 'app'] as const) {
  registerFallbackCatalog(namespace, { es: es[namespace], en: en[namespace] });
}
