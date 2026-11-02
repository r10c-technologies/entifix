import type { DomainEvent } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { describeServerPushContract } from '../contracts/server-push.contract.js';
import { makeInMemoryServerPush } from './server-push.js';

describeServerPushContract('makeInMemoryServerPush', makeInMemoryServerPush);

describe('makeInMemoryServerPush', () => {
  it('records every publish, received or not', async () => {
    const event: DomainEvent = {
      name: 'thing.changed',
      id: 'e1',
      source: 'spec',
      at: '2026-11-02T00:00:00.000Z',
      correlationId: 'e1',
      data: {},
    };
    const published = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const push = yield* makeInMemoryServerPush({ topicsOf: () => [] });
          yield* push.publish(event);
          return push.published();
        }),
      ),
    );
    expect(published).toEqual([event]);
  });
});
