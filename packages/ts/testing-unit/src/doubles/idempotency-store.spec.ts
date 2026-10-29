import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { describeIdempotencyStoreContract } from '../contracts/idempotency-store.contract.js';
import { makeInMemoryIdempotencyStore } from './idempotency-store.js';

describeIdempotencyStoreContract('the in-memory double', (clock, retentionMs) =>
  Effect.sync(() =>
    makeInMemoryIdempotencyStore({ retentionMs, now: () => clock.now() }),
  ),
);

describe('makeInMemoryIdempotencyStore', () => {
  it('defaults to the wall clock, and ignores completing a key it never held', async () => {
    const store = makeInMemoryIdempotencyStore({ retentionMs: 1000 });
    await Effect.runPromise(store.complete('nope', { status: 200, body: '' }));

    expect(store.records.size).toBe(0);
    expect(await Effect.runPromise(store.claim('k', 'f'))).toEqual({
      _tag: 'claimed',
    });
  });
});
