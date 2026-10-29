import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { discardIfStale, isStale } from './inbox.js';
import { aggregateKey } from './outbox.js';

describe('aggregateKey', () => {
  it('names an aggregate by type and id', () => {
    expect(aggregateKey({ type: 'product-order', id: 'o-1' })).toBe(
      'product-order/o-1',
    );
  });
});

describe('isStale', () => {
  it('discards a version at or below the one applied, and nothing when none was', () => {
    expect(isStale(3, 2)).toBe(true);
    expect(isStale(3, 3)).toBe(true);
    expect(isStale(3, 4)).toBe(false);
    expect(isStale(undefined, 1)).toBe(false);
  });
});

describe('discardIfStale', () => {
  // A delete at v=n beats a late v=n-1.
  it('answers stale for a late version, and applies a newer one', async () => {
    let applied = 0;
    const apply = Effect.sync(() => {
      applied += 1;
      return 'applied' as const;
    });

    expect(
      await Effect.runPromise(discardIfStale(Effect.succeed(5), 4, apply)),
    ).toBe('stale');
    expect(
      await Effect.runPromise(discardIfStale(Effect.succeed(5), 6, apply)),
    ).toBe('applied');
    expect(applied).toBe(1);
  });
});
