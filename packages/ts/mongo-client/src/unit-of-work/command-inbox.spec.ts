import { EntifixConnError } from '@entifix/core';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import { Effect, Option } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import {
  COMMAND_INBOX_COLLECTION,
  ensureCommandInboxIndexes,
  readCommandReplay,
} from './command-inbox.js';

describe('the command inbox', () => {
  it('reports an index it could not ensure as a store failure', async () => {
    const fake = makeFakeMongoDb();
    fake.failOn('createIndex', new Error('not primary'));

    const error = await Effect.runPromise(
      ensureCommandInboxIndexes(fake.db as Db).pipe(Effect.flip),
    );

    expect(error).toBeInstanceOf(EntifixConnError);
  });

  it('reads no replay for a claim taken without one', async () => {
    const fake = makeFakeMongoDb({
      [COMMAND_INBOX_COLLECTION]: [
        { commandId: 'c-1', claimedAt: '2026-01-01T00:00:00.000Z' },
      ],
    });

    expect(
      await Effect.runPromise(readCommandReplay(fake.db as Db, 'c-1')),
    ).toEqual(Option.none());
  });

  it('reports a claim it could not read as a store failure', async () => {
    const fake = makeFakeMongoDb();
    fake.failOn('findOne', new Error('network down'));

    const error = await Effect.runPromise(
      readCommandReplay(fake.db as Db, 'c-2').pipe(Effect.flip),
    );

    expect(error).toBeInstanceOf(EntifixConnError);
  });
});
