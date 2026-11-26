import type { EntityRepository, RepositoryFailure } from '@entifix/business';
import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  RELEVANCE,
} from '@entifix/core';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { run, runExit, runFailure } from '../effect/run.js';

/**
 * The entity every implementation of the contract is exercised against. It is
 * declared here rather than by each caller so the suite controls exactly which
 * fields exist.
 */
// `labelMember` is what relevance scores against (ADR 0033).
@entity({ key: 'contract-widget', labelMember: 'name' })
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

  @accessor({ type: 'scalarCollection', filterable: true })
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

    it('matches `like` and `nlike` with accents ignored on both sides', async () => {
      await withRepository(
        async repository => {
          const like = await run(
            repository.load<ContractWidget>({
              filtering: [
                { property: 'name', operator: 'like', value: 'cafe' },
              ],
            }),
          );
          const accented = await run(
            repository.load<ContractWidget>({
              filtering: [
                { property: 'name', operator: 'like', value: 'NIÑO' },
              ],
            }),
          );
          const nlike = await run(
            repository.load<ContractWidget>({
              filtering: [
                { property: 'name', operator: 'nlike', value: 'café' },
              ],
            }),
          );

          expect(like.items.map(item => item.id)).toEqual(['w-1']);
          expect(accented.items.map(item => item.id)).toEqual(['w-2']);
          expect(nlike.items.map(item => item.id)).toEqual(['w-2']);
        },
        [
          makeContractWidget('w-1', 'Café de Olla', 10),
          makeContractWidget('w-2', 'nino', 20),
        ],
      );
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

    it('matches `==` against any element of an array member', async () => {
      await withRepository(
        async repository => {
          const blue = await run(
            repository.load<ContractWidget>({
              filtering: [{ property: 'tags', operator: 'eq', value: 'blue' }],
            }),
          );
          expect(blue.items.map(item => item.id)).toEqual(['w-1']);

          const green = await run(
            repository.load<ContractWidget>({
              filtering: [{ property: 'tags', operator: 'eq', value: 'green' }],
            }),
          );
          expect(green.items.map(item => item.id)).toEqual(['w-1', 'w-2']);
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

    it('ranks by relevance: a label prefix, then a word start, then anywhere', async () => {
      // ADR 0033: one point per word matched elsewhere, two for a word that
      // starts a word of the label, three for one the label starts with;
      // ties fall to the next key.
      await withRepository(
        async repository => {
          const page = await run(
            repository.load<ContractWidget>({
              filtering: [
                { property: 'name', operator: 'like', value: 'lamp' },
              ],
              sorting: [
                {
                  0: { property: RELEVANCE, type: 'desc' },
                  1: { property: 'size', type: 'asc' },
                },
              ],
            }),
          );

          expect(page.items.map(item => item.id)).toEqual([
            'w-4',
            'w-2',
            'w-3',
            'w-1',
          ]);
          expect(page.total).toBe(4);
        },
        [
          makeContractWidget('w-1', 'Superlamp', 10),
          makeContractWidget('w-2', 'Desk lamp', 20),
          makeContractWidget('w-3', 'Floor lamp', 30),
          makeContractWidget('w-4', 'Lámpara', 40),
          makeContractWidget('w-5', 'Chair', 50),
        ],
      );
    });

    it('falls to the next key when relevance has no word to weigh', async () => {
      await withRepository(async repository => {
        const page = await run(
          repository.load<ContractWidget>({
            sorting: [
              {
                0: { property: RELEVANCE, type: 'desc' },
                1: { property: 'size', type: 'desc' },
              },
            ],
            page: 1,
            pageSize: 2,
          }),
        );

        expect(page.items.map(item => item.size)).toEqual([30, 20]);
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

/**
 * The entity the revision contract runs against: {@link ContractWidget}'s
 * shape plus the one member that makes its saves checked (ADR 0032).
 */
@entity({ key: 'revised-widget' })
export class RevisedWidget implements Entity {
  #id?: EntityId;
  #name?: string;
  #revision?: number;

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

  @accessor({ type: 'revision' })
  get revision(): number | undefined {
    return this.#revision;
  }
  set revision(value: number | undefined) {
    this.#revision = value;
  }
}

export const makeRevisedWidget = (
  id: EntityId,
  name: string,
  revision?: number,
): RevisedWidget => {
  const widget = new RevisedWidget();
  widget.id = id;
  widget.name = name;
  widget.revision = revision;
  return widget;
};

export interface EntityRepositoryRevisionContractOptions {
  /**
   * Builds a repository over `seed`, whose records are stored at revision 1.
   * Called fresh for each test.
   */
  makeRepository(
    seed: RevisedWidget[],
  ): EntityRepository | Promise<EntityRepository>;
}

/**
 * What a save of an entity that declares a `revision` means on every adapter
 * that writes: a create never overwrites, an update names the revision it read
 * and moves it, and a stale save writes nothing — including when two race.
 */
export const describeEntityRepositoryRevisionContract = (
  name: string,
  { makeRepository }: EntityRepositoryRevisionContractOptions,
): void => {
  describe(`EntityRepository revision contract: ${name}`, () => {
    const seeded = () => [
      makeRevisedWidget('r-1', 'Alpha', 1),
      makeRevisedWidget('r-2', 'Beta', 1),
    ];

    const failureOf = (effect: ReturnType<EntityRepository['get']>) =>
      runFailure(effect) as Promise<{ _tag: string; current?: number }>;

    it('carries the revision on a record and on a list row', async () => {
      const repository = await makeRepository(seeded());

      const one = await run(repository.get<RevisedWidget>('r-1'));
      const page = await run(repository.load<RevisedWidget>({}));

      expect(one.revision).toBe(1);
      expect(page.items.map(item => item.revision)).toEqual([1, 1]);
    });

    it('creates at revision 1, minting an id when there is none', async () => {
      const repository = await makeRepository(seeded());

      const created = await run(
        repository.save<RevisedWidget>(makeRevisedWidget(undefined, 'Gamma')),
      );

      expect(created.id).toBeDefined();
      expect(created.revision).toBe(1);
      const stored = await run(repository.get<RevisedWidget>(created.id));
      expect(stored.revision).toBe(1);
    });

    it('creates under a client-minted id', async () => {
      const repository = await makeRepository(seeded());

      const created = await run(
        repository.save<RevisedWidget>(makeRevisedWidget('r-9', 'Mine')),
      );

      expect(created.id).toBe('r-9');
      expect(created.revision).toBe(1);
    });

    it('refuses a create over an existing id and leaves the record unchanged', async () => {
      const repository = await makeRepository(seeded());

      const failure = await failureOf(
        repository.save<RevisedWidget>(makeRevisedWidget('r-1', 'Overwrite')),
      );

      expect(failure._tag).toBe('StaleRevision');
      const stored = await run(repository.get<RevisedWidget>('r-1'));
      expect(stored.name).toBe('Alpha');
      expect(stored.revision).toBe(1);
    });

    it('answers revision n + 1 to an update at n', async () => {
      const repository = await makeRepository(seeded());

      const updated = await run(
        repository.save<RevisedWidget>(makeRevisedWidget('r-1', 'Renamed', 1)),
      );

      expect(updated.revision).toBe(2);
      const stored = await run(repository.get<RevisedWidget>('r-1'));
      expect(stored.name).toBe('Renamed');
      expect(stored.revision).toBe(2);
    });

    it('refuses a second update at the revision already spent, naming the current one', async () => {
      const repository = await makeRepository(seeded());
      await run(
        repository.save<RevisedWidget>(makeRevisedWidget('r-1', 'First', 1)),
      );

      const failure = await failureOf(
        repository.save<RevisedWidget>(makeRevisedWidget('r-1', 'Second', 1)),
      );

      expect(failure._tag).toBe('StaleRevision');
      expect(failure.current).toBe(2);
      const stored = await run(repository.get<RevisedWidget>('r-1'));
      expect(stored.name).toBe('First');
    });

    it('answers NotFound to an update of a record that is gone', async () => {
      const repository = await makeRepository(seeded());

      const failure = await failureOf(
        repository.save<RevisedWidget>(makeRevisedWidget('r-404', 'Ghost', 1)),
      );

      expect(failure._tag).toBe('NotFound');
    });

    it('does not check a delete', async () => {
      const repository = await makeRepository(seeded());

      await run(repository.delete<RevisedWidget>('r-1'));

      const page = await run(repository.load<RevisedWidget>({}));
      expect(page.items.map(item => item.id)).toEqual(['r-2']);
    });

    it('leaves exactly one winner when two saves name the same revision', async () => {
      const repository = await makeRepository(seeded());

      const exits = await Promise.all([
        runExit(
          repository.save<RevisedWidget>(makeRevisedWidget('r-1', 'Left', 1)),
        ),
        runExit(
          repository.save<RevisedWidget>(makeRevisedWidget('r-1', 'Right', 1)),
        ),
      ]);

      expect(exits.filter(exit => Exit.isSuccess(exit))).toHaveLength(1);
      expect(exits.filter(exit => Exit.isFailure(exit))).toHaveLength(1);
      const stored = await run(repository.get<RevisedWidget>('r-1'));
      expect(stored.revision).toBe(2);
      expect(['Left', 'Right']).toContain(stored.name);
    });

    it('leaves exactly one winner when two creates name the same id', async () => {
      const repository = await makeRepository(seeded());

      const exits = await Promise.all([
        runExit(
          repository.save<RevisedWidget>(makeRevisedWidget('r-7', 'Left')),
        ),
        runExit(
          repository.save<RevisedWidget>(makeRevisedWidget('r-7', 'Right')),
        ),
      ]);

      expect(exits.filter(exit => Exit.isSuccess(exit))).toHaveLength(1);
      const page = await run(repository.load<RevisedWidget>({}));
      expect(page.items.filter(item => item.id === 'r-7')).toHaveLength(1);
    });
  });
};

const STATED_PHASES = ['draft', 'released'] as const;
const IN_DRAFT = { member: 'phase', in: ['draft'] } as const;

/**
 * The entity the state contract runs against: a record saved and deleted only
 * in `draft` ([ADR 0029](../../../../../docs/adr/0029-a-verb-declares-the-states-it-is-legal-from.md)).
 * Its state is stored under an alias, so an adapter that conditions on the
 * member's name rather than its stored key fails the suite.
 */
@entity({
  key: 'stated-widget',
  writableWhen: IN_DRAFT,
  deletableWhen: IN_DRAFT,
  readOnlyReasonKey: 'entity:stated-widget.readOnly',
})
export class StatedWidget implements Entity {
  #id?: EntityId;
  #name?: string;
  #phase?: string;

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

  @accessor({ type: 'enum', enumValues: STATED_PHASES, alias: 'stage' })
  get phase(): string | undefined {
    return this.#phase;
  }
  set phase(value: string | undefined) {
    this.#phase = value;
  }
}

export const makeStatedWidget = (
  id: EntityId,
  name: string,
  phase: (typeof STATED_PHASES)[number],
): StatedWidget => {
  const widget = new StatedWidget();
  widget.id = id;
  widget.name = name;
  widget.phase = phase;
  return widget;
};

export interface EntityRepositoryStateContractOptions {
  /** Builds a repository over `seed`. Called fresh for each test. */
  makeRepository(
    seed: StatedWidget[],
  ): EntityRepository | Promise<EntityRepository>;
}

/**
 * What a write conditioned on a record's state means on every adapter that
 * writes: the condition is part of the write, a record in another state is
 * refused `UnavailableInState` and left as it was, and a save racing a move out
 * of the allowed states leaves exactly one winner.
 */
export const describeEntityRepositoryStateContract = (
  name: string,
  { makeRepository }: EntityRepositoryStateContractOptions,
): void => {
  describe(`EntityRepository state contract: ${name}`, () => {
    const seeded = () => [
      makeStatedWidget('s-1', 'Alpha', 'draft'),
      makeStatedWidget('s-2', 'Beta', 'released'),
    ];
    const expect_ = { expect: IN_DRAFT };

    const failureOf = (effect: Effect.Effect<unknown, RepositoryFailure>) =>
      runFailure(effect) as Promise<{
        _tag: string;
        member?: string;
        state?: string;
        allowed?: readonly string[];
      }>;

    it('saves a record that holds an allowed state', async () => {
      const repository = await makeRepository(seeded());

      await run(
        repository.save(makeStatedWidget('s-1', 'Renamed', 'draft'), expect_),
      );

      const stored = await run(repository.get<StatedWidget>('s-1'));
      expect(stored.name).toBe('Renamed');
    });

    it('moves a record out of the allowed states in the write that checks them', async () => {
      const repository = await makeRepository(seeded());

      await run(
        repository.save(makeStatedWidget('s-1', 'Alpha', 'released'), expect_),
      );

      const stored = await run(repository.get<StatedWidget>('s-1'));
      expect(stored.phase).toBe('released');
    });

    it('refuses a save of a record in another state, naming both, and writes nothing', async () => {
      const repository = await makeRepository(seeded());

      const failure = await failureOf(
        repository.save(makeStatedWidget('s-2', 'Changed', 'draft'), expect_),
      );

      expect(failure).toMatchObject({
        _tag: 'UnavailableInState',
        member: 'phase',
        state: 'released',
        allowed: ['draft'],
      });
      const stored = await run(repository.get<StatedWidget>('s-2'));
      expect(stored.name).toBe('Beta');
      expect(stored.phase).toBe('released');
    });

    it('answers NotFound to a conditioned save of a record that is not there, and creates nothing', async () => {
      const repository = await makeRepository(seeded());

      const failure = await failureOf(
        repository.save(makeStatedWidget('s-9', 'Ghost', 'draft'), expect_),
      );

      expect(failure._tag).toBe('NotFound');
      const page = await run(repository.load<StatedWidget>({}));
      expect(page.total).toBe(2);
    });

    it('deletes a record that holds an allowed state', async () => {
      const repository = await makeRepository(seeded());

      await run(repository.delete<StatedWidget>('s-1', expect_));

      const page = await run(repository.load<StatedWidget>({}));
      expect(page.items.map(item => item.id)).toEqual(['s-2']);
    });

    it('refuses a delete of a record in another state and keeps it', async () => {
      const repository = await makeRepository(seeded());

      const failure = await failureOf(
        repository.delete<StatedWidget>('s-2', expect_),
      );

      expect(failure).toMatchObject({
        _tag: 'UnavailableInState',
        state: 'released',
      });
      const page = await run(repository.load<StatedWidget>({}));
      expect(page.total).toBe(2);
    });

    it('treats a conditioned delete of an unknown id as a no-op', async () => {
      const repository = await makeRepository(seeded());

      await run(repository.delete<StatedWidget>('s-9', expect_));

      const page = await run(repository.load<StatedWidget>({}));
      expect(page.total).toBe(2);
    });

    it('leaves exactly one winner when a release races a conditioned delete', async () => {
      const repository = await makeRepository(seeded());

      const exits: Exit.Exit<unknown, RepositoryFailure>[] = await Promise.all([
        runExit<unknown, RepositoryFailure>(
          repository.save(
            makeStatedWidget('s-1', 'Alpha', 'released'),
            expect_,
          ),
        ),
        runExit<unknown, RepositoryFailure>(
          repository.delete<StatedWidget>('s-1', expect_),
        ),
      ]);

      expect(exits.filter(exit => Exit.isSuccess(exit))).toHaveLength(1);
      expect(exits.filter(exit => Exit.isFailure(exit))).toHaveLength(1);
    });
  });
};
