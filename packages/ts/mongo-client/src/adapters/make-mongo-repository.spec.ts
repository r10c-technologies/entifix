import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  serializeEntity,
} from '@entifix/core';
import { run, runExit, runFailure } from '@entifix/testing-unit';
import {
  ContractWidget,
  describeEntityRepositoryContract,
  describeEntityRepositoryRevisionContract,
  makeContractWidget,
  makeRevisedWidget,
  RevisedWidget,
} from '@entifix/testing-unit/contracts';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import { Exit } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { makeMongoRepository } from './make-mongo-repository.js';

const COLLECTION = 'contract-widget';

/** No `key`, so the collection has to be named after the class instead. */
@entity()
class UnkeyedWidget implements Entity {
  #id?: EntityId;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

/**
 * The repository runs against a fake mongodb driver rather than a fake port, so
 * the filter translation, the `_id` projection, the upsert rule and the error
 * mapping are all executed for real.
 */
const withFakeDb = (seed: ContractWidget[] = []) => {
  const fake = makeFakeMongoDb({
    [COLLECTION]: seed.map(widget => serializeEntity(ContractWidget, widget)),
  });
  return {
    fake,
    repository: makeMongoRepository(fake.db as Db, ContractWidget),
  };
};

describeEntityRepositoryContract('mongo adapter over a fake driver', {
  makeRepository: seed => withFakeDb(seed).repository,
});

describe('makeMongoRepository', () => {
  it('names the collection after the entity key', async () => {
    const { fake, repository } = withFakeDb([
      makeContractWidget('w-1', 'Alpha', 10),
    ]);

    await run(repository.load<ContractWidget>({}));

    expect(fake.operations.every(op => op.collection === COLLECTION)).toBe(
      true,
    );
  });

  it('falls back to the class name when the entity declares no key', async () => {
    const fake = makeFakeMongoDb({});
    const repository = makeMongoRepository(fake.db as Db, UnkeyedWidget);

    await run(repository.load<UnkeyedWidget>({}));

    expect(fake.operations.every(op => op.collection === 'UnkeyedWidget')).toBe(
      true,
    );
  });

  it('projects Mongo’s own _id away, so it never reaches an entity', async () => {
    const fake = makeFakeMongoDb({
      [COLLECTION]: [
        { _id: 'mongo-internal', id: 'w-1', name: 'Alpha', size: 10 },
      ],
    });
    const repository = makeMongoRepository(fake.db as Db, ContractWidget);

    const found = await run(repository.get<ContractWidget>('w-1'));

    expect(found).toBeInstanceOf(ContractWidget);
    expect(found).not.toHaveProperty('_id');
  });

  it('counts the whole match, not just the page', async () => {
    const { repository } = withFakeDb([
      makeContractWidget('w-1', 'Alpha', 10),
      makeContractWidget('w-2', 'Beta', 20),
      makeContractWidget('w-3', 'Gamma', 30),
    ]);

    const page = await run(
      repository.load<ContractWidget>({ page: 1, pageSize: 2 }),
    );

    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
  });

  it('upserts on save so a create and an update take the same path', async () => {
    const { fake, repository } = withFakeDb();

    await run(
      repository.save<ContractWidget>(makeContractWidget('w-1', 'Alpha', 10)),
    );

    expect(fake.operations.map(op => op.op)).toContain('replaceOne');
    expect(fake.read(COLLECTION)).toEqual([
      { id: 'w-1', name: 'Alpha', size: 10, tags: [] },
    ]);
  });

  it('writes the minted id into the document, not only onto the entity', async () => {
    const { fake, repository } = withFakeDb();

    const saved = await run(
      repository.save<ContractWidget>(
        makeContractWidget(undefined, 'Alpha', 10),
      ),
    );

    // Entities are addressed by their own `id`; a document stored without one
    // would be unreachable by every later read.
    expect(fake.read(COLLECTION)[0]?.['id']).toBe(saved.id);
  });

  it('maps a driver failure onto Unavailable', async () => {
    const { fake, repository } = withFakeDb([
      makeContractWidget('w-1', 'Alpha', 10),
    ]);
    fake.failWith(new Error('connection refused'));

    const exit = await runExit(repository.load<ContractWidget>({}));

    expect(Exit.isFailure(exit)).toBe(true);
  });

  // Each driver call has its own error mapping, and only a per-operation
  // failure reaches the later ones — a blanket failure never gets past `find`.
  describe('per-operation failures', () => {
    const seed = [makeContractWidget('w-1', 'Alpha', 10)];

    it.each([
      [
        'countDocuments',
        (repository: ReturnType<typeof withFakeDb>['repository']) =>
          repository.load<ContractWidget>({}),
      ],
      [
        'findOne',
        (repository: ReturnType<typeof withFakeDb>['repository']) =>
          repository.get<ContractWidget>('w-1'),
      ],
      [
        'replaceOne',
        (repository: ReturnType<typeof withFakeDb>['repository']) =>
          repository.save<ContractWidget>(
            makeContractWidget('w-1', 'Alpha', 10),
          ),
      ],
      [
        'deleteOne',
        (repository: ReturnType<typeof withFakeDb>['repository']) =>
          repository.delete<ContractWidget>('w-1'),
      ],
    ])('fails when %s rejects', async (operation, run) => {
      const { fake, repository } = withFakeDb(seed);
      fake.failOn(operation, new Error('connection refused'));

      expect(Exit.isFailure(await runExit(run(repository)))).toBe(true);
    });
  });
});

describe('makeMongoRepository inside a session', () => {
  it('writes inside the transaction, so a rollback takes the write with it', async () => {
    const fake = makeFakeMongoDb();
    const session = fake.startSession();
    const repository = makeMongoRepository(fake.db as Db, ContractWidget, {
      session: session as never,
    });

    session.startTransaction();
    await run(repository.save(makeContractWidget('w-held', 'held', 1)));
    // Read through the same session: the unit sees its own write.
    const page = await run(repository.load({}));
    await run(repository.get('w-held'));
    await run(repository.delete('w-held'));
    await session.abortTransaction();

    expect(page.total).toBe(1);
    expect(fake.read(COLLECTION)).toEqual([]);
  });
});

const REVISED = 'revised-widget';

const withRevisedDb = (seed: RevisedWidget[] = []) => {
  const fake = makeFakeMongoDb({
    [REVISED]: seed.map(widget => serializeEntity(RevisedWidget, widget)),
  });
  return {
    fake,
    repository: makeMongoRepository(fake.db as Db, RevisedWidget),
  };
};

describeEntityRepositoryRevisionContract('mongo adapter over a fake driver', {
  makeRepository: seed => withRevisedDb(seed).repository,
});

describe('makeMongoRepository for an entity that declares a revision', () => {
  const seed = [makeRevisedWidget('r-1', 'Alpha', 1)];

  it('ensures the unique index on id once per database, however many creates', async () => {
    const { fake, repository } = withRevisedDb();

    await run(repository.save<RevisedWidget>(makeRevisedWidget('a', 'A')));
    await run(repository.save<RevisedWidget>(makeRevisedWidget('b', 'B')));

    expect(
      fake.operations.filter(operation => operation.op === 'createIndex'),
    ).toHaveLength(1);
  });

  it('does not touch the index on an update', async () => {
    const { fake, repository } = withRevisedDb(seed);

    await run(
      repository.save<RevisedWidget>(makeRevisedWidget('r-1', 'Beta', 1)),
    );

    expect(
      fake.operations.some(operation => operation.op === 'createIndex'),
    ).toBe(false);
    expect(fake.operations.map(operation => operation.op)).not.toContain(
      'insertOne',
    );
  });

  it('writes an update without an upsert, so a missing record is never created', async () => {
    const { fake, repository } = withRevisedDb();

    const exit = await runExit(
      repository.save<RevisedWidget>(makeRevisedWidget('r-9', 'Ghost', 1)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(fake.read(REVISED)).toEqual([]);
  });

  it('tries the index again after it failed, and fails the create meanwhile', async () => {
    const { fake, repository } = withRevisedDb();
    fake.failOnce('createIndex', new Error('connection refused'));

    const first = await runExit(
      repository.save<RevisedWidget>(makeRevisedWidget('a', 'A')),
    );
    await run(repository.save<RevisedWidget>(makeRevisedWidget('a', 'A')));

    expect(Exit.isFailure(first)).toBe(true);
    expect(
      fake.operations.filter(operation => operation.op === 'createIndex'),
    ).toHaveLength(2);
  });

  it.each([
    ['insertOne', makeRevisedWidget('a', 'A')],
    ['replaceOne', makeRevisedWidget('r-1', 'Beta', 1)],
  ])(
    'fails with the store failure when %s rejects',
    async (operation, widget) => {
      const { fake, repository } = withRevisedDb(seed);
      fake.failOn(operation, new Error('connection refused'));

      const exit = await runExit(repository.save<RevisedWidget>(widget));

      expect(Exit.isFailure(exit)).toBe(true);
    },
  );

  it('fails with the store failure when naming a stale save cannot read the record', async () => {
    const { fake, repository } = withRevisedDb(seed);
    fake.failOn('findOne', new Error('connection refused'));

    const exit = await runExit(
      repository.save<RevisedWidget>(makeRevisedWidget('r-1', 'Stale', 9)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('answers a stale save with the revision that is stored', async () => {
    const { repository } = withRevisedDb(seed);

    const failure = await runFailure(
      repository.save<RevisedWidget>(makeRevisedWidget('r-1', 'Stale', 9)),
    );

    expect(failure).toMatchObject({
      _tag: 'StaleRevision',
      entity: 'revised-widget',
      current: 1,
    });
  });
});
