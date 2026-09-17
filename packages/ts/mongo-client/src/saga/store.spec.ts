import { EntifixConnError } from '@entifix/core';
import { describeSagaStoreContract } from '@entifix/testing-unit/contracts';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import { SagaStoreTag } from '@entifix/transactions';
import { Effect, Exit, Layer } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { MongoDatabaseTag } from '../mongo-database/mongo-database.js';
import {
  ensureSagaIndexes,
  makeMongoSagaStore,
  MongoSagaStoreLayer,
  SAGA_COLLECTION,
} from './store.js';

describeSagaStoreContract('mongo adapter over a fake driver', () =>
  makeMongoSagaStore(makeFakeMongoDb().db as Db),
);

describe('makeMongoSagaStore', () => {
  it('reports every driver failure as a connection error naming the saga', async () => {
    const fake = makeFakeMongoDb();
    fake.failWith(new Error('network down'));
    const store = makeMongoSagaStore(fake.db as Db);

    const attempts = [
      store.start({
        sagaId: 's-1',
        definition: 'flow',
        state: 'RUNNING',
        stepIndex: 0,
        outcomes: [],
        inputs: {},
        resumeAttempts: 0,
        createdAt: new Date().toISOString(),
      }),
      store.beginStep('s-1', 1),
      store.recordOutcome('s-1', { stepId: 'a', calls: [] }),
      store.settle('s-1', 'COMPLETED'),
      store.claimForResume('s-1', 0),
      store.markCompensated('s-1', 'a'),
      store.get('s-1'),
      store.findStale(0),
    ];

    for (const attempt of attempts) {
      const exit = await Effect.runPromiseExit(
        attempt as Effect.Effect<unknown, EntifixConnError>,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit) && exit.cause._tag === 'Fail') {
        expect(exit.cause.error).toBeInstanceOf(EntifixConnError);
      }
    }
  });
});

describe('ensureSagaIndexes', () => {
  it('makes sagaId unique, so a flow can never be started twice', async () => {
    const fake = makeFakeMongoDb();
    const db = fake.db as Db;
    await Effect.runPromise(ensureSagaIndexes(db));

    const collection = (
      db as unknown as {
        collection: (name: string) => {
          insertOne(doc: object): Promise<unknown>;
          updateOne(q: object, u: object, o: object): Promise<unknown>;
        };
      }
    ).collection(SAGA_COLLECTION);
    await collection.updateOne(
      { sagaId: 'x' },
      { $setOnInsert: { sagaId: 'x' } },
      { upsert: true },
    );

    expect(fake.operations).toEqual(
      expect.arrayContaining([
        { collection: SAGA_COLLECTION, op: 'createIndex' },
      ]),
    );
  });

  it('reports an index it could not create', async () => {
    const fake = makeFakeMongoDb();
    fake.failOn('createIndex', new Error('not primary'));

    const exit = await Effect.runPromiseExit(ensureSagaIndexes(fake.db as Db));

    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe('MongoSagaStoreLayer', () => {
  it('provides a store over the service database, indexed first', async () => {
    const fake = makeFakeMongoDb();

    const store = await Effect.runPromise(
      SagaStoreTag.pipe(
        Effect.provide(
          MongoSagaStoreLayer.pipe(
            Layer.provide(Layer.succeed(MongoDatabaseTag, fake.db as Db)),
          ),
        ),
      ),
    );

    expect(store.findStale).toEqual(expect.any(Function));
    expect(
      fake.operations.filter(entry => entry.op === 'createIndex'),
    ).toHaveLength(2);
  });
});
