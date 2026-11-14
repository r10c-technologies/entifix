import {
  accessor,
  applyFiltering,
  type Entity,
  entity,
  type EntityId,
  type EntityLoadRequest,
  Unavailable,
} from '@entifix/core';
import { Context, Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { EntityRepositoryTag } from './entity.repository.js';
import {
  createReferenceLabels,
  REFERENCE_BATCH_SIZE,
  ReferenceLabelsTag,
} from './reference-labels.js';

/** A record's values, read by every getter below. */
class Values implements Entity {
  constructor(readonly values: Record<string, unknown> = {}) {}
  protected read(name: string): never {
    return this.values[name] as never;
  }
  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.read('id');
  }
}

@entity({ domain: 'catalog', key: 'offering', labelMember: 'title' })
class Offering extends Values {
  @accessor({ type: 'localized' })
  get title(): unknown {
    return this.read('title');
  }
  @accessor({ type: 'string' })
  get code(): string {
    return this.read('code');
  }
}

/** No label member: named by its record label's undeclared rung. */
@entity({ domain: 'catalog', key: 'brand' })
class Brand extends Values {
  @accessor({ type: 'number' })
  get rank(): number {
    return this.read('rank');
  }
}

@entity({ domain: 'stock', key: 'item', labelMember: 'offeringId' })
class StockItem extends Values {
  @accessor({ type: 'string', references: { entity: 'catalog:offering' } })
  get offeringId(): string {
    return this.read('offeringId');
  }
  @accessor({ type: 'scalarCollection' })
  get tags(): unknown {
    return this.read('tags');
  }
}

@entity({ key: 'keyless' })
class Keyless extends Values {}

/**
 * A hand-rolled double rather than `makeInMemoryEntityRepository` from
 * `@entifix/testing-unit`, which depends on this package. It counts the loads
 * it serves, which is what this port promises to keep low.
 */
function repositoryFor(items: Entity[], fail = false) {
  const loads: EntityLoadRequest<Entity>[] = [];
  const context = Context.make(EntityRepositoryTag, {
    get: () => Effect.die('not used'),
    load: (request: EntityLoadRequest<Entity>) => {
      loads.push(request);
      if (fail) return Effect.fail(new Unavailable({ dependency: 'catalog' }));
      return Effect.succeed({
        items: applyFiltering(items, request.filtering),
        total: items.length,
        request,
      });
    },
    save: () => Effect.die('not used'),
    delete: () => Effect.die('not used'),
  } as unknown as EntityRepositoryTag['Service']);
  return { context, loads };
}

const offerings = [
  new Offering({ id: 'o-1', title: { en: 'Flange' }, code: 'F' }),
  new Offering({ id: 'o-2', title: { en: 'Bolt' } }),
  new Offering({ id: 'o-3', title: { en: '' } }),
];

const resolve = (
  context: Context.Context<ReferenceLabelsTag>,
  key: string,
  ids: string[],
) =>
  Effect.runPromiseExit(Context.get(context, ReferenceLabelsTag).resolve(key, ids));

describe('createReferenceLabels', () => {
  it('reads 50 ids naming 3 records in one load with an in filter of 3', async () => {
    const repository = repositoryFor(offerings);
    const context = createReferenceLabels([[Offering, repository.context]]);
    const ids = Array.from({ length: 50 }, (_, index) => `o-${(index % 3) + 1}`);

    const exit = await resolve(context, 'catalog:offering', ids);

    expect(repository.loads).toHaveLength(1);
    expect(repository.loads[0]).toEqual({
      filtering: [
        { property: 'id', operator: 'in', values: ['o-1', 'o-2', 'o-3'] },
      ],
      page: 1,
      pageSize: 3,
    });
    expect(Exit.isSuccess(exit) && [...exit.value]).toEqual([
      ['o-1', { en: 'Flange' }],
      ['o-2', { en: 'Bolt' }],
    ]);
  });

  it('leaves an unknown id out of the map rather than failing', async () => {
    const context = createReferenceLabels([
      [Offering, repositoryFor(offerings).context],
    ]);
    const exit = await resolve(context, 'catalog:offering', ['o-1', 'gone']);
    expect(Exit.isSuccess(exit) && [...exit.value.keys()]).toEqual(['o-1']);
  });

  it('reads nothing for no ids', async () => {
    const repository = repositoryFor(offerings);
    const context = createReferenceLabels([[Offering, repository.context]]);
    const exit = await resolve(context, 'catalog:offering', []);
    expect(Exit.isSuccess(exit) && exit.value.size).toBe(0);
    expect(repository.loads).toHaveLength(0);
  });

  it('splits a long list into bounded reads', async () => {
    const repository = repositoryFor([]);
    const context = createReferenceLabels([[Offering, repository.context]]);
    const ids = Array.from(
      { length: REFERENCE_BATCH_SIZE + 1 },
      (_, index) => `o-${index}`,
    );
    await resolve(context, 'catalog:offering', ids);
    expect(repository.loads.map(load => load.pageSize)).toEqual([
      REFERENCE_BATCH_SIZE,
      1,
    ]);
  });

  it('names by a declared labelProperty, and by the record label without one', async () => {
    const context = createReferenceLabels([
      [Offering, repositoryFor(offerings).context, { labelProperty: 'code' }],
      [
        Brand,
        repositoryFor([new Brand({ id: 'b-1', rank: 3 }), new Brand({ id: 'b-2' })])
          .context,
      ],
    ]);
    const byCode = await resolve(context, 'catalog:offering', ['o-1', 'o-2']);
    const byRank = await resolve(context, 'catalog:brand', ['b-1', 'b-2']);
    expect(Exit.isSuccess(byCode) && [...byCode.value]).toEqual([['o-1', 'F']]);
    expect(Exit.isSuccess(byRank) && [...byRank.value]).toEqual([['b-1', '3']]);
  });

  it('fails the read when the repository fails, and an unregistered key', async () => {
    const context = createReferenceLabels([
      [Offering, repositoryFor(offerings, true).context],
    ]);
    expect(Exit.isFailure(await resolve(context, 'catalog:offering', ['o-1']))).toBe(
      true,
    );
    expect(Exit.isFailure(await resolve(context, 'sales:order', ['x']))).toBe(
      true,
    );
  });

  it('lists the entities it can name', () => {
    const context = createReferenceLabels([
      [Offering, repositoryFor([]).context],
    ]);
    expect([...Context.get(context, ReferenceLabelsTag).entities]).toEqual([
      ['catalog:offering', Offering],
    ]);
  });

  it('refuses a target named by a reference, a collection, or nothing it has', () => {
    const { context } = repositoryFor([]);
    expect(() => createReferenceLabels([[StockItem, context]])).toThrow(
      /one hop/,
    );
    expect(() =>
      createReferenceLabels([[StockItem, context, { labelProperty: 'tags' }]]),
    ).toThrow(/one hop/);
    expect(() =>
      createReferenceLabels([[Offering, context, { labelProperty: 'nope' }]]),
    ).toThrow(/one hop/);
  });

  it('refuses a target registered twice, or one with no domain:key', () => {
    const { context } = repositoryFor([]);
    expect(() =>
      createReferenceLabels([
        [Offering, context],
        [Offering, context],
      ]),
    ).toThrow(/registered twice/);
    expect(() => createReferenceLabels([[Keyless, context]])).toThrow(
      /domain and a key/,
    );
  });
});
