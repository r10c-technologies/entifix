import { describeOutboxContract } from '@entifix/testing-unit/contracts';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import { drainOutbox } from '@entifix/transactions/engine';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

import { ensureOutboxIndexes, makeMongoOutbox } from './store.js';

// The Mongo outbox and its relay, held to the contract every outbox meets,
// over a fake driver one level below the adapter.
describeOutboxContract('mongo over a fake driver', () => {
  const db = makeFakeMongoDb().db as Db;
  const outbox = makeMongoOutbox(db);
  return Effect.as(ensureOutboxIndexes(db), {
    outbox,
    drain: (bus, maxAttempts) =>
      drainOutbox(outbox, bus, { maxAttempts, database: 'contract' }),
  });
});
