import { describe, expect, it } from 'vitest';

import { EntifixBuildError } from '../base-entities/entifix-error/index.js';
import { accessor } from '../entity-definition/decorators/accessor/index.js';
import { entity } from '../entity-definition/decorators/entity/index.js';
import type { Entity, EntityId } from '../types/Entity.js';
import {
  FACET_PARAM,
  facetFilterParam,
  parseFacetQueryParams,
  serializeFacetQueryParams,
} from './facet-query-url.js';

@entity({ key: 'gadget' })
class Gadget implements Entity {
  #id?: EntityId;
  #brand?: string;
  #price = 0;
  #serial?: string;
  #internal?: string;
  #title?: Readonly<Record<string, string>>;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string' })
  get brand(): string | undefined {
    return this.#brand;
  }
  set brand(value: string | undefined) {
    this.#brand = value;
  }

  @accessor({ type: 'number' })
  get price(): number {
    return this.#price;
  }
  set price(value: number) {
    this.#price = value;
  }

  /** Wire key differs from the accessor name; the count is keyed by the wire key. */
  @accessor({ type: 'string', alias: 'serial_no' })
  get serial(): string | undefined {
    return this.#serial;
  }
  set serial(value: string | undefined) {
    this.#serial = value;
  }

  @accessor({ type: 'string', filterable: false })
  get internal(): string | undefined {
    return this.#internal;
  }
  set internal(value: string | undefined) {
    this.#internal = value;
  }

  @accessor({ type: 'localized' })
  get title(): Readonly<Record<string, string>> | undefined {
    return this.#title;
  }
  set title(value: Readonly<Record<string, string>> | undefined) {
    this.#title = value;
  }
}

const params = (entries: readonly (readonly [string, string])[]) =>
  new URLSearchParams(entries.map(([key, value]) => [key, value]));

describe('serializeFacetQueryParams', () => {
  it('names each member, and each filtering under its own parameter', () => {
    const serialized = serializeFacetQueryParams<Gadget>([
      {
        member: 'brand',
        filtering: [{ property: 'price', operator: 'gte', value: 10 }],
      },
      { member: 'price', filtering: [] },
    ]);

    expect(serialized.getAll(FACET_PARAM)).toEqual(['brand', 'price']);
    expect(serialized.get(facetFilterParam('brand'))).toBe('price=ge=10');
    expect(serialized.has(facetFilterParam('price'))).toBe(false);
  });
});

describe('parseFacetQueryParams', () => {
  it('reads back what was serialized', () => {
    const parsed = parseFacetQueryParams(
      Gadget,
      serializeFacetQueryParams<Gadget>([
        {
          member: 'brand',
          filtering: [{ property: 'price', operator: 'gte', value: 10 }],
        },
        { member: 'price' },
      ]),
    );

    expect(parsed).toEqual([
      {
        member: 'brand',
        filtering: [
          {
            operator: 'and',
            values: [{ property: 'price', operator: 'gte', value: 10 }],
          },
        ],
      },
      { member: 'price' },
    ]);
  });

  it('keys a member by its wire key, whichever name the URL used', () => {
    expect(
      parseFacetQueryParams(Gadget, params([[FACET_PARAM, 'serial']])),
    ).toEqual([{ member: 'serial_no' }]);
  });

  it('treats a blank filtering as none', () => {
    expect(
      parseFacetQueryParams(
        Gadget,
        params([
          [FACET_PARAM, 'brand'],
          [facetFilterParam('brand'), '  '],
        ]),
      ),
    ).toEqual([{ member: 'brand' }]);
  });

  it.each([
    ['no facet', params([])],
    [
      'a facet named twice',
      params([
        [FACET_PARAM, 'brand'],
        [FACET_PARAM, 'brand'],
      ]),
    ],
    ['a member that is not filterable', params([[FACET_PARAM, 'internal']])],
    ['a member that does not exist', params([[FACET_PARAM, 'nope']])],
    ['a localized member', params([[FACET_PARAM, 'title']])],
    ['one locale of a localized member', params([[FACET_PARAM, 'title.en']])],
    [
      'a filtering over a member that is not filterable',
      params([
        [FACET_PARAM, 'brand'],
        [facetFilterParam('brand'), 'internal==x'],
      ]),
    ],
  ])('refuses %s as a build error', (_, search) => {
    expect(() => parseFacetQueryParams(Gadget, search)).toThrow(
      EntifixBuildError,
    );
  });
});
