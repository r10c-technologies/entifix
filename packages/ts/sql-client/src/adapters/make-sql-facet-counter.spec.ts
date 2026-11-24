import {
  accessor,
  defineLocales,
  type Entity,
  entity,
  type EntityId,
  InvalidQuery,
  resetLocales,
  Unavailable,
} from '@entifix/core';
import { makeFakeSqlClient } from '@entifix/testing-unit/drivers';
import { Effect, Exit } from 'effect';
import type { SqlClient } from 'effect/sql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeSqlFacetCounter } from './make-sql-facet-counter.js';

@entity({ key: 'case' })
class Case implements Entity {
  #id?: EntityId;
  #brand?: string;
  #fits: readonly string[] = [];
  #title?: Record<string, string>;
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
  @accessor({ type: 'scalarCollection', filterable: true })
  get fits(): readonly string[] {
    return this.#fits;
  }
  set fits(value: readonly string[]) {
    this.#fits = value;
  }
  @accessor({ type: 'localized' })
  get title(): Record<string, string> | undefined {
    return this.#title;
  }
  set title(value: Record<string, string> | undefined) {
    this.#title = value;
  }
}

@entity()
class Unkeyed implements Entity {
  #id?: EntityId;
  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

beforeEach(() => defineLocales({ locales: ['en', 'es'], defaultLocale: 'en' }));
afterEach(() => resetLocales());

const counterOver = (fake = makeFakeSqlClient()) => ({
  fake,
  counter: makeSqlFacetCounter(
    fake.client as unknown as SqlClient.SqlClient,
    Case,
  ),
});

describe('makeSqlFacetCounter', () => {
  it('asks nothing of the store when nothing is asked', async () => {
    const { fake, counter } = counterOver();
    expect(await Effect.runPromise(counter.count<Case>([]))).toEqual({});
    expect(fake.executions).toHaveLength(0);
  });

  it('groups a scalar member, skips a missing value, and orders by count then value', async () => {
    const { fake, counter } = counterOver();
    fake.respondTo('"brand"', [
      { value: 'Zeta', count: 2 },
      { value: 'Acme', count: 2 },
      { value: 'Solo', count: 5 },
      { value: { not: 'countable' }, count: 9 },
    ]);
    const counts = await Effect.runPromise(
      counter.count<Case>([{ member: 'brand' }]),
    );
    expect(counts).toEqual({
      brand: [
        { value: 'Solo', count: 5 },
        { value: 'Acme', count: 2 },
        { value: 'Zeta', count: 2 },
      ],
    });
    expect(fake.lastExecution?.sql).toContain(
      'WHERE true AND "brand" IS NOT NULL',
    );
  });

  it('counts a list per element, under its own filtering', async () => {
    const { fake, counter } = counterOver();
    fake.respondTo('jsonb_array_elements', [{ value: 'm-1', count: 3 }]);
    const counts = await Effect.runPromise(
      counter.count<Case>([
        {
          member: 'fits',
          filtering: [{ property: 'fits', operator: 'ne', value: 'm-9' }],
        },
      ]),
    );
    expect(counts).toEqual({ fits: [{ value: 'm-1', count: 3 }] });
    const { sql, params } = fake.lastExecution ?? { sql: '', params: [] };
    expect(sql).toContain(
      'CROSS JOIN LATERAL jsonb_array_elements("fits") AS element(value)',
    );
    expect(sql).toContain('NOT COALESCE("fits" @> $1::jsonb, false)');
    expect(params).toEqual(['["m-9"]']);
  });

  it('counts a localized member one locale at a time', async () => {
    const { fake, counter } = counterOver();
    fake.respondTo('"title"->>', [{ value: 'Funda', count: 1 }]);
    const counts = await Effect.runPromise(
      counter.count<Case>([{ member: 'title.es' as keyof Case }]),
    );
    expect(counts).toEqual({ 'title.es': [{ value: 'Funda', count: 1 }] });
  });

  it('refuses a member the entity does not declare, as the caller’s query', async () => {
    const { counter } = counterOver();
    const exit = await Effect.runPromiseExit(
      counter.count<Case>([{ member: 'secret' as keyof Case }]),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain(InvalidQuery.name);
  });

  it('surfaces a store failure', async () => {
    const fake = makeFakeSqlClient();
    fake.failWith('connection reset');
    const { counter } = counterOver(fake);
    const exit = await Effect.runPromiseExit(
      counter.count<Case>([{ member: 'brand' }]),
    );
    expect(JSON.stringify(exit)).toContain(Unavailable.name);
  });

  it('names the table after the class when the entity declares no key', async () => {
    const fake = makeFakeSqlClient();
    const counter = makeSqlFacetCounter(
      fake.client as unknown as SqlClient.SqlClient,
      Unkeyed,
    );
    await Effect.runPromise(counter.count<Unkeyed>([{ member: 'id' }]));
    expect(fake.lastExecution?.sql).toContain('FROM "Unkeyed"');
  });
});
