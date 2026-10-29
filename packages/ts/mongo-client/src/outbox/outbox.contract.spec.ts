import { describeOutboxContract } from '@entifix/testing-unit/contracts';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

import { drainOutbox } from './relay.js';
import { ensureOutboxIndexes, makeMongoOutbox } from './store.js';

// The Mongo outbox and its relay, held to the contract every outbox meets,
// over a fake driver one level below the adapter (ADR 0063).
describeOutboxContract('mongo over a fake driver', () => {
  const db = makeFakeMongoDb().db as Db;
  const outbox = makeMongoOutbox(db);
  return Effect.as(ensureOutboxIndexes(db), {
    outbox,
    drain: (bus, maxAttempts) =>
      drainOutbox(outbox, bus, { maxAttempts, database: 'contract' }),
  });
});
