/**
 * The controls catalog for every spec, so a string a component renders is the
 * catalog's and not a raw key — a spec asserting against `docs.search.close`
 * would pass for the wrong reason.
 */
import { defineCatalogs } from '@entifix/i18n';
import { controlsCatalogs } from '@entifix/react-controls';

defineCatalogs({
  resources: { es: controlsCatalogs.es, en: controlsCatalogs.en },
  namespaces: ['controls'],
  defaultNS: 'controls',
  locales: ['es', 'en'],
  defaultLocale: 'en',
});
