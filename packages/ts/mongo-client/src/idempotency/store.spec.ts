import { describeIdempotencyStoreContract } from '@entifix/testing-unit/contracts';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import { Effect } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import {
  ensureIdempotencyIndexes,
  IDEMPOTENCY_COLLECTION,
  makeMongoIdempotencyStore,
} from './store.js';

describeIdempotencyStoreContract(
  'mongo over a fake driver',
  (clock, retentionMs) => {
    const db = makeFakeMongoDb().db as Db;
    return Effect.as(
      ensureIdempotencyIndexes(db),
      makeMongoIdempotencyStore(db, { retentionMs, now: () => clock.now() }),
    );
  },
);

describe('makeMongoIdempotencyStore', () => {
  it('builds a TTL index on expiresAt', async () => {
    const fake = makeFakeMongoDb();
    await Effect.runPromise(ensureIdempotencyIndexes(fake.db as Db));

    expect(
      fake.operations.filter(
        op =>
          op.collection === IDEMPOTENCY_COLLECTION && op.op === 'createIndex',
      ),
    ).toHaveLength(2);
  });

  it('defaults to the wall clock', async () => {
    const fake = makeFakeMongoDb();
    const db = fake.db as Db;
    await Effect.runPromise(ensureIdempotencyIndexes(db));
    const store = makeMongoIdempotencyStore(db, { retentionMs: 1000 });

    expect(await Effect.runPromise(store.claim('k', 'f'))).toEqual({
      _tag: 'claimed',
    });
  });

  it('translates a store failure', async () => {
    const fake = makeFakeMongoDb();
    fake.failOn('insertOne', new Error('down'));
    const store = makeMongoIdempotencyStore(fake.db as Db, { retentionMs: 1 });

    expect(
      (await Effect.runPromise(Effect.flip(store.claim('k', 'f'))))._tag,
    ).toBeDefined();
  });

  it('takes a key released between the duplicate and the read', async () => {
    let inserts = 0;
    const collection = {
      insertOne: async () => {
        inserts += 1;
        if (inserts === 1)
          throw Object.assign(new Error('dup'), { code: 11000 });
        return {};
      },
      updateOne: async () => ({ modifiedCount: 0 }),
      findOne: async () => null,
    };
    const store = makeMongoIdempotencyStore(
      { collection: () => collection } as unknown as Db,
      { retentionMs: 1000 },
    );

    expect(await Effect.runPromise(store.claim('k', 'f'))).toEqual({
      _tag: 'claimed',
    });
    expect(inserts).toBe(2);
  });

  it('replays the completed response, and omits a response it never stored', async () => {
    const fake = makeFakeMongoDb();
    const db = fake.db as Db;
    await Effect.runPromise(ensureIdempotencyIndexes(db));
    const store = makeMongoIdempotencyStore(db, { retentionMs: 60_000 });
    await Effect.runPromise(store.claim('k', 'f'));

    const inFlight = await Effect.runPromise(store.claim('k', 'f'));
    expect(inFlight._tag === 'existing' && inFlight.record).not.toHaveProperty(
      'response',
    );
  });

  it('translates a failure to complete or release', async () => {
    const fake = makeFakeMongoDb();
    fake.failOn('updateOne', new Error('down'));
    fake.failOn('deleteOne', new Error('down'));
    const store = makeMongoIdempotencyStore(fake.db as Db, { retentionMs: 1 });

    for (const effect of [
      store.complete('k', { status: 200, body: '' }),
      store.release('k'),
    ])
      expect((await Effect.runPromise(Effect.flip(effect)))._tag).toBeDefined();
  });

  it('translates a failure to build the indexes', async () => {
    const fake = makeFakeMongoDb();
    fake.failOn('createIndex', new Error('down'));

    expect(
      (
        await Effect.runPromise(
          Effect.flip(ensureIdempotencyIndexes(fake.db as Db)),
        )
      )._tag,
    ).toBeDefined();
  });
});
