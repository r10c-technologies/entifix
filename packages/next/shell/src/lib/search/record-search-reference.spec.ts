import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  makeEntityPageEnvelope,
} from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { defineRecordSearchSource } from './record-search-source.js';

/**
 * Local fixtures, as in `record-search-source.spec.ts`: an offering a person
 * knows by its name, the stock that refers to it and knows no name of its own,
 * and an order nothing names at all.
 */
@entity({ key: 'offering', domain: 'testing', labelMember: 'name' })
class Offering implements Entity {
  #id?: EntityId;
  #name?: string;
  #title?: Readonly<Record<string, string>>;
  #code?: string;
  #rank?: number;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', alias: 'offering_name' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }

  @accessor({ type: 'localized' })
  get title(): Readonly<Record<string, string>> | undefined {
    return this.#title;
  }
  set title(value: Readonly<Record<string, string>> | undefined) {
    this.#title = value;
  }

  @accessor({ type: 'string', sortable: false })
  get code(): string | undefined {
    return this.#code;
  }
  set code(value: string | undefined) {
    this.#code = value;
  }

  @accessor({ type: 'number' })
  get rank(): number | undefined {
    return this.#rank;
  }
  set rank(value: number | undefined) {
    this.#rank = value;
  }
}

/** An entity that declares no label member: nothing to match a term against. */
@entity({ key: 'nameless', domain: 'testing' })
class Nameless implements Entity {
  #id?: EntityId;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

@entity({ key: 'stock', domain: 'testing' })
class Stock implements Entity {
  #id?: EntityId;
  #offeringId?: string;
  #otherId?: string;
  #onHand?: number;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    alias: 'offering_id',
    references: { entity: 'testing:offering' },
  })
  get offeringId(): string | undefined {
    return this.#offeringId;
  }
  set offeringId(value: string | undefined) {
    this.#offeringId = value;
  }

  @accessor({ type: 'string', references: { entity: 'testing:nameless' } })
  get otherId(): string | undefined {
    return this.#otherId;
  }
  set otherId(value: string | undefined) {
    this.#otherId = value;
  }

  @accessor({ type: 'number' })
  get onHand(): number | undefined {
    return this.#onHand;
  }
  set onHand(value: number | undefined) {
    this.#onHand = value;
  }
}

/** Named by its buyer when it has one, else by nothing. */
@entity({ key: 'order', domain: 'testing', labelMember: 'buyer' })
class Order implements Entity {
  #id?: EntityId;
  #buyer?: string;
  #offeringId?: string;
  #unsortable?: string;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string' })
  get buyer(): string | undefined {
    return this.#buyer;
  }
  set buyer(value: string | undefined) {
    this.#buyer = value;
  }

  @accessor({ type: 'string', references: { entity: 'testing:offering' } })
  get offeringId(): string | undefined {
    return this.#offeringId;
  }
  set offeringId(value: string | undefined) {
    this.#offeringId = value;
  }

  @accessor({ type: 'string', sortable: false })
  get unsortable(): string | undefined {
    return this.#unsortable;
  }
  set unsortable(value: string | undefined) {
    this.#unsortable = value;
  }
}

const throughOfferings = (over: Record<string, unknown> = {}) =>
  defineRecordSearchSource({
    entityConstructor: Stock,
    baseUrl: 'http://stock.test',
    searchProperty: 'offeringId',
    labelKey: 'entity:stock.plural',
    href: id => `/stock/${id}`,
    reference: { entityConstructor: Offering, baseUrl: 'http://catalog.test' },
    ...over,
  });

const stockPage = (rows: ReadonlyArray<Record<string, unknown>>) =>
  makeEntityPageEnvelope(Stock, {
    items: rows as unknown as Stock[],
    total: rows.length,
    request: {},
  });

const offeringPage = (rows: ReadonlyArray<Record<string, unknown>>) =>
  makeEntityPageEnvelope(Offering, {
    items: rows as unknown as Offering[],
    total: rows.length,
    request: {},
  });

describe('a source searched through a reference', () => {
  it('matches the term against the referenced entity’s label, at its owner', () => {
    const through = throughOfferings().through;

    expect(through?.url('Café', 5, 'es')).toBe(
      'http://catalog.test/api/offering?rsql=offering_name%3Dlike%3DCaf%C3%A9&sort=%2Boffering_name&page=1&pageSize=5',
    );
  });

  it('matches a localized label in the reader’s locale', () => {
    const through = throughOfferings({
      reference: {
        entityConstructor: Offering,
        baseUrl: 'http://catalog.test',
        labelProperty: 'title',
      },
    }).through;

    const url = new URL(through?.url('cafe', 5, 'en') ?? '');
    expect(url.searchParams.get('rsql')).toBe('title.en=like=cafe');
    expect(url.searchParams.get('sort')).toBe('+title.en');
    expect(
      through?.read(
        offeringPage([
          { id: 'o-1', title: { es: 'Café', en: 'Coffee' } },
          { id: 'o-2-with-a-long-id', title: {} },
        ]),
        'en',
      ),
    ).toEqual([
      { id: 'o-1', label: 'Coffee' },
      { id: 'o-2-with-a-long-id', label: 'o-2-with' },
    ]);
  });

  it('reads the matches, falling back to a short id for one with no name', () => {
    const through = throughOfferings().through;

    expect(
      through?.read(
        offeringPage([
          { id: 'o-1', name: 'Café molido' },
          { id: 'b1c2d3e4-0000-0000-0000-000000000000', name: '' },
          { name: 'No id, cannot be referred to' },
        ]),
        'es',
      ),
    ).toEqual([
      { id: 'o-1', label: 'Café molido' },
      { id: 'b1c2d3e4-0000-0000-0000-000000000000', label: 'b1c2d3e4' },
    ]);
    expect(through?.read({ not: 'a page' }, 'es')).toBeUndefined();
  });

  it('asks for the records referring to the matches, by the member’s wire key', () => {
    const url = new URL(
      throughOfferings().through?.urlFor(['o-1', 'o-2'], 5) ?? '',
    );

    expect(url.origin + url.pathname).toBe('http://stock.test/api/stock');
    expect(url.searchParams.get('rsql')).toBe('offering_id=in=(o-1,o-2)');
    expect(url.searchParams.get('sort')).toBeNull();
    expect(url.searchParams.get('pageSize')).toBe('5');
  });

  it('labels each record by the name it refers to, in the order the names matched', () => {
    const page = throughOfferings().read(
      stockPage([
        { id: 's-1', offeringId: 'o-1' },
        { id: 's-2', offeringId: 'o-2' },
        { id: 's-orphan-with-a-long-id', offeringId: 'o-9' },
      ]),
      'es',
      new Map([
        ['o-2', 'Café de altura'],
        ['o-1', 'Café molido'],
      ]),
    );

    expect(page?.items.map(({ id, label }) => [id, label])).toEqual([
      ['s-2', 'Café de altura'],
      ['s-1', 'Café molido'],
      ['s-orphan-with-a-long-id', 's-orphan'],
    ]);
    expect(page?.items[0]).toEqual({
      id: 's-2',
      label: 'Café de altura',
      entity: 'stock',
      href: '/stock/s-2',
    });
  });

  describe('refusing a declaration it cannot honour', () => {
    it('refuses a member that does not reference the entity searched through', () => {
      expect(() => throughOfferings({ searchProperty: 'onHand' })).toThrow(
        /Cannot search Stock by "onHand": the member does not reference testing:offering/,
      );
    });

    it('refuses a label member beside the reference, which labels', () => {
      expect(() => throughOfferings({ labelProperty: 'onHand' })).toThrow(
        /labelled by the records it refers to/,
      );
    });

    it.each([
      ['declares no label member', Nameless, 'otherId', undefined],
      ['names a member that is not sortable', Offering, 'offeringId', 'code'],
      ['names a member that is not text', Offering, 'offeringId', 'rank'],
      ['names a member it does not have', Offering, 'offeringId', 'missing'],
    ])(
      'refuses a target that %s',
      (_case, target, searchProperty, labelProperty) => {
        expect(() =>
          throughOfferings({
            searchProperty,
            reference: {
              entityConstructor: target,
              baseUrl: 'http://catalog.test',
              ...(labelProperty === undefined ? {} : { labelProperty }),
            },
          }),
        ).toThrow(/is not named by a filterable, sortable text member/);
      },
    );
  });
});

describe('a source whose records name themselves', () => {
  const orders = (over: Record<string, unknown> = {}) =>
    defineRecordSearchSource({
      entityConstructor: Order,
      baseUrl: 'http://orders.test',
      searchProperty: 'buyer',
      labelKey: 'entity:order.plural',
      href: id => `/orders/${id}`,
      ...over,
    });

  it('sorts the group by what the term matched', () => {
    expect(new URL(orders().url('ana', 5, 'es')).searchParams.get('sort')).toBe(
      '+buyer',
    );
  });

  it('names a record as every surface does, else by its short id, unnamed', () => {
    const page = orders().read(
      makeEntityPageEnvelope(Order, {
        items: [
          { id: 'order-1', buyer: 'Ana' },
          // A reference names nothing here: the record is called by its own id.
          {
            id: '8a564966-aaaa-bbbb-cccc-000000000000',
            offeringId: 'o-1',
          },
        ] as unknown as Order[],
        total: 2,
        request: {},
      }),
      'es',
    );

    expect(
      page?.items.map(({ label, unnamed }) => ({ label, unnamed })),
    ).toEqual([
      { label: 'Ana', unnamed: undefined },
      { label: '8a564966', unnamed: true },
    ]);
  });

  it('refuses a search member it cannot sort by', () => {
    expect(() => orders({ searchProperty: 'unsortable' })).toThrow(
      /sorted by the search member, and it is not sortable/,
    );
  });
});
