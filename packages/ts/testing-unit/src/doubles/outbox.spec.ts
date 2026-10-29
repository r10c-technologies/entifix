import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { describeOutboxContract } from '../contracts/outbox.contract.js';
import { makeInMemoryOutbox } from './outbox.js';

describeOutboxContract('the in-memory double', () =>
  Effect.sync(() => {
    const outbox = makeInMemoryOutbox();
    return { outbox, drain: outbox.drain };
  }),
);

describe('makeInMemoryOutbox', () => {
  it('ignores a markSent or recordFailure for an entry it never held', async () => {
    const outbox = makeInMemoryOutbox();
    const stranger = {
      eventId: 'x',
      aggregate: { type: 't', id: 'x' },
      version: 1,
      event: {
        name: 'n',
        id: 'x',
        source: 's',
        at: '2026-01-01T00:00:00.000Z',
        data: {},
      },
      sent: false,
      attempts: 0,
      quarantined: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    await Effect.runPromise(outbox.markSent(stranger));
    await Effect.runPromise(outbox.recordFailure(stranger, 'e', true));

    expect(outbox.entries).toEqual([]);
    expect(await Effect.runPromise(outbox.stats())).toEqual({
      pending: 0,
      quarantined: 0,
    });
  });

  // Two versions written in the same instant still leave in version order.
  it('orders entries with one timestamp by version', async () => {
    const outbox = makeInMemoryOutbox();
    const at = '2026-01-01T00:00:00.000Z';
    for (const version of [2, 1])
      await Effect.runPromise(
        outbox.enqueue({
          name: 'n',
          id: `a:${String(version)}`,
          source: 's',
          at,
          aggregate: { type: 't', id: 'a' },
          version,
          data: {},
        }),
      );

    expect(
      (await Effect.runPromise(outbox.pending(10))).map(entry => entry.version),
    ).toEqual([1, 2]);
  });
});
