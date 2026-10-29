import type { IdempotencyStore } from '@entifix/business';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

/** A clock a case can move. */
export interface ContractClock {
  now: () => number;
}

/**
 * What every {@link IdempotencyStore} must guarantee: one claim per dedup key
 * even under a concurrent burst, a duplicate that sees the first request's
 * fingerprint and state, a completed answer kept for replay, a released key
 * free again, and an expired record treated as never written.
 *
 * `make` builds a fresh store over the case's clock and a retention of
 * `retentionMs`.
 */
export const describeIdempotencyStoreContract = (
  name: string,
  make: (
    clock: ContractClock,
    retentionMs: number,
  ) => Effect.Effect<IdempotencyStore, unknown>,
): void => {
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
  const fresh = (start = Date.UTC(2026, 0, 1)) => {
    const clock: ContractClock = { now: () => start };
    return { clock, store: run(make(clock, 60_000)) };
  };

  describe(`IdempotencyStore contract: ${name}`, () => {
    it('claims a key once, and shows a duplicate the request in flight', async () => {
      const store = await fresh().store;

      expect(await run(store.claim('k', 'f-1'))).toEqual({ _tag: 'claimed' });
      expect(await run(store.claim('k', 'f-2'))).toMatchObject({
        _tag: 'existing',
        record: { dedupKey: 'k', fingerprint: 'f-1', state: 'inFlight' },
      });
    });

    it('keeps a completed answer for a duplicate to replay', async () => {
      const store = await fresh().store;
      await run(store.claim('k', 'f-1'));
      await run(
        store.complete('k', {
          status: 201,
          contentType: 'application/json',
          body: '{"ok":true}',
        }),
      );

      expect(await run(store.claim('k', 'f-1'))).toMatchObject({
        _tag: 'existing',
        record: {
          state: 'completed',
          response: { status: 201, body: '{"ok":true}' },
        },
      });
    });

    it('frees a released key', async () => {
      const store = await fresh().store;
      await run(store.claim('k', 'f-1'));
      await run(store.release('k'));

      expect(await run(store.claim('k', 'f-1'))).toEqual({ _tag: 'claimed' });
    });

    it('treats an expired record as never written', async () => {
      const { clock, store: made } = fresh();
      const store = await made;
      await run(store.claim('k', 'f-1'));
      const later = clock.now() + 60_001;
      clock.now = () => later;

      expect(await run(store.claim('k', 'f-2'))).toEqual({ _tag: 'claimed' });
    });

    // A sequential pass proves nothing about a race: fire the burst.
    it('gives exactly one of a concurrent burst the claim', async () => {
      const store = await fresh().store;

      const claims = await run(
        Effect.all(
          Array.from({ length: 8 }, () => store.claim('k', 'f-1')),
          { concurrency: 'unbounded' },
        ),
      );

      expect(claims.filter(claim => claim._tag === 'claimed')).toHaveLength(1);
    });

    it('keeps two dedup keys apart', async () => {
      const store = await fresh().store;
      await run(store.claim('caller-a|route|k', 'f-1'));

      expect(await run(store.claim('caller-b|route|k', 'f-1'))).toEqual({
        _tag: 'claimed',
      });
    });
  });
};
