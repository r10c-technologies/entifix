import type { EntityRepository } from '@entifix/business';
import { accessor, type Entity, entity, type EntityId } from '@entifix/core';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { run, runExit } from '../effect/run.js';

/**
 * The entity every implementation of the contract is exercised against. It is
 * declared here rather than by each caller so the suite controls exactly which
 * fields exist.
 */
@entity({ key: 'contract-widget' })
export class ContractWidget implements Entity {
  #id?: EntityId;
  #name?: string;
  #size?: number;
  #tags: readonly string[] = [];
  #title?: Readonly<Record<string, string>>;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }

  @accessor({ type: 'number' })
  get size(): number | undefined {
    return this.#size;
  }
  set size(value: number | undefined) {
    this.#size = value;
  }

  @accessor({ type: 'scalarCollection' })
  get tags(): readonly string[] {
    return this.#tags;
  }
  set tags(value: readonly string[]) {
    this.#tags = value;
  }

  @accessor({ type: 'localized' })
  get title(): Readonly<Record<string, string>> | undefined {
    return this.#title;
  }
  set title(value: Readonly<Record<string, string>> | undefined) {
    this.#title = value;
  }
}

export const makeContractWidget = (
  id: EntityId,
  name: string,
  size: number,
  tags: readonly string[] = [],
): ContractWidget => {
  const widget = new ContractWidget();
  widget.id = id;
  widget.name = name;
  widget.size = size;
  widget.tags = tags;
  return widget;
};

export interface EntityRepositoryContractOptions {
  /**
   * Builds a repository over `seed`. Called fresh for each test, so no state
   * leaks between them.
   */
  makeRepository(
    seed: ContractWidget[],
  ): EntityRepository | Promise<EntityRepository>;
}

/**
 * The reads every {@link EntityRepository} must answer alike: `load` with its
 * paging, filtering and sorting, and `get`. A read-only adapter — one over
 * static files, say — runs this half alone, since it refuses `save` and
 * `delete` by design.
 */
export const describeEntityRepositoryReadContract = (
  name: string,
  { makeRepository }: EntityRepositoryContractOptions,
): void => {
  describe(`EntityRepository read contract: ${name}`, () => {
    const seeded = () => [
      makeContractWidget('w-1', 'Alpha', 10),
      makeContractWidget('w-2', 'Beta', 20),
      makeContractWidget('w-3', 'Gamma', 30),
    ];

    const withRepository = async (
      use: (repository: EntityRepository) => Promise<void>,
      seed: ContractWidget[] = seeded(),
    ) => {
      await use(await makeRepository(seed));
    };

    it('keeps a record unchanged when a read instance is mutated without a save', async () => {
      await withRepository(async repository => {
        const read = await run(repository.get<ContractWidget>('w-1'));
        read.name = 'Mutated';

        const again = await run(repository.get<ContractWidget>('w-1'));
        expect(again.name).toBe('Alpha');

        const page = await run(repository.load<ContractWidget>({}));
        page.items[0]!.name = 'Mutated';
        const reloaded = await run(repository.load<ContractWidget>({}));
        expect(reloaded.items[0]!.name).toBe('Alpha');
      });
    });

    it('loads every stored entity with its total', async () => {
      await withRepository(async repository => {
        const page = await run(repository.load<ContractWidget>({}));

        expect(page.total).toBe(3);
        expect(page.items.map(item => item.name)).toEqual([
          'Alpha',
          'Beta',
          'Gamma',
        ]);
      });
    });

    it('echoes the request it served on the page', async () => {
      await withRepository(async repository => {
        const request = { page: 1, pageSize: 2 };
        const page = await run(repository.load<ContractWidget>(request));

        expect(page.request).toEqual(request);
      });
    });

    it('pages with a 1-based page number', async () => {
      await withRepository(async repository => {
        const page = await run(
          repository.load<ContractWidget>({ page: 2, pageSize: 2 }),
        );

        expect(page.items).toHaveLength(1);
        expect(page.items[0]?.name).toBe('Gamma');
        // The total counts matches, not the page.
        expect(page.total).toBe(3);
      });
    });

    it('filters by an equality operator', async () => {
      await withRepository(async repository => {
        const page = await run(
          repository.load<ContractWidget>({
            filtering: [{ property: 'name', operator: 'eq', value: 'Beta' }],
          }),
        );

        expect(page.items).toHaveLength(1);
        expect(page.items[0]?.id).toBe('w-2');
        expect(page.total).toBe(1);
      });
    });

    it('filters by a range operator', async () => {
      await withRepository(async repository => {
        const page = await run(
          repository.load<ContractWidget>({
            filtering: [
              { property: 'size', operator: 'between', start: 15, end: 35 },
            ],
          }),
        );

        expect(page.items.map(item => item.id)).toEqual(['w-2', 'w-3']);
      });
    });

    it('matches `like` case-insensitively on a substring', async () => {
      await withRepository(async repository => {
        const page = await run(
          repository.load<ContractWidget>({
            filtering: [{ property: 'name', operator: 'like', value: 'et' }],
          }),
        );

        expect(page.items.map(item => item.id)).toEqual(['w-2']);
      });
    });

    it('matches `in` and `nin` against any element of an array member', async () => {
      await withRepository(
        async repository => {
          const tagged = await run(
            repository.load<ContractWidget>({
              filtering: [
                { property: 'tags', operator: 'in', values: ['blue', 'red'] },
              ],
            }),
          );
          expect(tagged.items.map(item => item.id)).toEqual(['w-1', 'w-3']);

          const untagged = await run(
            repository.load<ContractWidget>({
              filtering: [
                { property: 'tags', operator: 'nin', values: ['blue', 'red'] },
              ],
            }),
          );
          expect(untagged.items.map(item => item.id)).toEqual(['w-2']);
        },
        [
          makeContractWidget('w-1', 'Alpha', 10, ['blue', 'green']),
          makeContractWidget('w-2', 'Beta', 20, ['green']),
          makeContractWidget('w-3', 'Gamma', 30, ['red']),
        ],
      );
    });

    it('filters and sorts a localized member one locale at a time', async () => {
      const titled = (
        id: string,
        name: string,
        title: Record<string, string>,
      ) => {
        const widget = makeContractWidget(id, name, 0);
        widget.title = title;
        return widget;
      };
      await withRepository(
        async repository => {
          const found = await run(
            repository.load<ContractWidget>({
              filtering: [
                {
                  property: 'title.es' as keyof ContractWidget,
                  operator: 'like',
                  value: 'SOPA',
                },
              ],
            }),
          );
          expect(found.items.map(item => item.id)).toEqual(['w-2']);

          const sorted = await run(
            repository.load<ContractWidget>({
              sorting: [
                {
                  0: {
                    property: 'title.en' as keyof ContractWidget,
                    type: 'asc',
                  },
                },
              ],
            }),
          );
          expect(sorted.items.map(item => item.id)).toEqual([
            'w-3',
            'w-1',
            'w-2',
          ]);
          expect(sorted.items[0]?.title).toEqual({
            en: 'Apple',
            es: 'Manzana',
          });
        },
        [
          titled('w-1', 'Alpha', { en: 'Bread', es: 'Pan' }),
          titled('w-2', 'Beta', { en: 'Soup', es: 'Sopa' }),
          titled('w-3', 'Gamma', { en: 'Apple', es: 'Manzana' }),
        ],
      );
    });

    it('sorts descending when asked to', async () => {
      await withRepository(async repository => {
        const page = await run(
          repository.load<ContractWidget>({
            sorting: [{ 0: { property: 'size', type: 'desc' } }],
          }),
        );

        expect(page.items.map(item => item.size)).toEqual([30, 20, 10]);
      });
    });

    it('reads a single entity by id', async () => {
      await withRepository(async repository => {
        const found = await run(repository.get<ContractWidget>('w-2'));

        expect(found.id).toBe('w-2');
        expect(found.name).toBe('Beta');
      });
    });

    it('fails rather than resolving undefined for an unknown id', async () => {
      await withRepository(async repository => {
        const exit = await runExit(repository.get<ContractWidget>('missing'));

        expect(Exit.isFailure(exit)).toBe(true);
      });
    });

    it('loads an empty page from an empty store', async () => {
      await withRepository(async repository => {
        const page = await run(repository.load<ContractWidget>({}));

        expect(page.items).toEqual([]);
        expect(page.total).toBe(0);
      }, []);
    });
  });
};

/** The writes every {@link EntityRepository} that accepts them must honour. */
export const describeEntityRepositoryWriteContract = (
  name: string,
  { makeRepository }: EntityRepositoryContractOptions,
): void => {
  describe(`EntityRepository write contract: ${name}`, () => {
    const seeded = () => [
      makeContractWidget('w-1', 'Alpha', 10),
      makeContractWidget('w-2', 'Beta', 20),
      makeContractWidget('w-3', 'Gamma', 30),
    ];

    const withRepository = async (
      use: (repository: EntityRepository) => Promise<void>,
      seed: ContractWidget[] = seeded(),
    ) => {
      await use(await makeRepository(seed));
    };

    it('keeps a saved record unchanged when the saved instance is mutated afterwards', async () => {
      await withRepository(async repository => {
        const widget = makeContractWidget('w-9', 'Delta', 40);
        const returned = await run(repository.save(widget));

        widget.name = 'Mutated';
        returned.name = 'Mutated too';

        const stored = await run(repository.get<ContractWidget>('w-9'));
        expect(stored.name).toBe('Delta');
      });
    });

    it('mints an id when saving an entity that has none', async () => {
      await withRepository(async repository => {
        const created = await run(
          repository.save<ContractWidget>(
            makeContractWidget(undefined, 'Delta', 40),
          ),
        );

        expect(created.id).toBeDefined();

        const page = await run(repository.load<ContractWidget>({}));
        expect(page.total).toBe(4);
      });
    });

    it('overwrites in place when saving an entity that already has an id', async () => {
      await withRepository(async repository => {
        await run(
          repository.save<ContractWidget>(
            makeContractWidget('w-2', 'Renamed', 25),
          ),
        );

        const found = await run(repository.get<ContractWidget>('w-2'));
        expect(found.name).toBe('Renamed');

        const page = await run(repository.load<ContractWidget>({}));
        expect(page.total).toBe(3);
      });
    });

    it('deletes by id', async () => {
      await withRepository(async repository => {
        await run(repository.delete<ContractWidget>('w-1'));

        const page = await run(repository.load<ContractWidget>({}));
        expect(page.items.map(item => item.id)).toEqual(['w-2', 'w-3']);
      });
    });

    it('deletes by entity', async () => {
      await withRepository(async repository => {
        await run(
          repository.delete<ContractWidget>(
            makeContractWidget('w-3', 'Gamma', 30),
          ),
        );

        const page = await run(repository.load<ContractWidget>({}));
        expect(page.items.map(item => item.id)).toEqual(['w-1', 'w-2']);
      });
    });

    it('treats deleting an unknown id as a no-op', async () => {
      await withRepository(async repository => {
        await run(repository.delete<ContractWidget>('missing'));

        const page = await run(repository.load<ContractWidget>({}));
        expect(page.total).toBe(3);
      });
    });
  });
};

/**
 * The behaviour every {@link EntityRepository} must exhibit, regardless of what
 * backs it: both halves.
 *
 * Run it against the in-memory fake *and* against each real adapter. That is
 * what stops a fake from drifting into a more forgiving version of the thing it
 * stands in for — the failure mode where a suite is green and production is
 * not. `entifix-ts-testing-integration` will run this same suite against real
 * infrastructure later.
 */
export const describeEntityRepositoryContract = (
  name: string,
  options: EntityRepositoryContractOptions,
): void => {
  describeEntityRepositoryReadContract(name, options);
  describeEntityRepositoryWriteContract(name, options);
};
