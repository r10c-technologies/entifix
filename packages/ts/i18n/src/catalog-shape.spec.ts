import { describe, expectTypeOf, it } from 'vitest';

import type { CatalogShape } from './catalog-shape.js';

/** The catalog a second locale translates, as `typeof en` would read it. */
interface En {
  title: string;
  empty: { lead: string };
}

describe('CatalogShape', () => {
  it('accepts a catalog with the same keys, every leaf a string', () => {
    const es = {
      title: 'Notas',
      empty: { lead: 'Nada aún' },
    } satisfies CatalogShape<En>;
    expectTypeOf(es).toExtend<CatalogShape<En>>();
  });

  it('refuses a missing key, an extra key and a leaf that is no string', () => {
    // @ts-expect-error — `empty.lead` is missing
    void ({ title: 'Notas', empty: {} } satisfies CatalogShape<En>);
    void ({
      title: 'Notas',
      empty: { lead: 'Nada aún' },
      // @ts-expect-error — no such key in `En`
      extra: 'x',
    } satisfies CatalogShape<En>);
    // @ts-expect-error — a leaf is a string
    void ({ title: 1, empty: { lead: '' } } satisfies CatalogShape<En>);
  });
});
