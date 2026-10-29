import {
  aggregateKey,
  type EventBus,
  type Outbox,
  type OutboxEntry,
} from '@entifix/transactions';
import { Effect, Result } from 'effect';

export interface InMemoryOutbox extends Outbox {
  /** Every entry, in enqueue order. */
  readonly entries: readonly OutboxEntry[];
  /**
   * One relay pass with the semantics every relay has: oldest first, in order
   * within each aggregate, a failing head holding back only its own aggregate,
   * and quarantine at `maxAttempts`.
   */
  readonly drain: (bus: EventBus, maxAttempts: number) => Effect.Effect<number>;
}

/** An {@link Outbox} over an array, for a spec that has no store. */
export const makeInMemoryOutbox = (): InMemoryOutbox => {
  const entries: OutboxEntry[] = [];
  const find = (eventId: string) =>
    entries.find(entry => entry.eventId === eventId);
  const pendingOnes = () =>
    entries
      .filter(entry => !entry.sent && !entry.quarantined)
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.version - b.version,
      );

  const outbox: Outbox = {
    enqueue: event =>
      Effect.sync(() => {
        if (find(event.id) !== undefined) return 'duplicate' as const;
        entries.push({
          eventId: event.id,
          aggregate: event.aggregate,
          version: event.version,
          event,
          sent: false,
          attempts: 0,
          quarantined: false,
          createdAt: event.at,
        });
        return 'enqueued' as const;
      }),
    pending: limit => Effect.sync(() => pendingOnes().slice(0, limit)),
    markSent: entry =>
      Effect.sync(() => {
        const stored = find(entry.eventId);
        if (stored !== undefined) stored.sent = true;
      }),
    recordFailure: (entry, error, quarantine) =>
      Effect.sync(() => {
        const stored = find(entry.eventId);
        if (stored === undefined) return;
        stored.attempts += 1;
        stored.lastError = error;
        stored.quarantined = quarantine;
      }),
    stats: () =>
      Effect.sync(() => {
        const pending = pendingOnes();
        const oldest = pending[0];
        return {
          pending: pending.length,
          quarantined: entries.filter(entry => entry.quarantined).length,
          ...(oldest === undefined
            ? {}
            : { oldestPendingAt: oldest.createdAt }),
        };
      }),
  };

  const drain = (bus: EventBus, maxAttempts: number) =>
    Effect.gen(function* () {
      const held = new Set<string>();
      let sent = 0;
      for (const entry of yield* outbox.pending(Number.MAX_SAFE_INTEGER)) {
        const key = aggregateKey(entry.aggregate);
        if (held.has(key)) continue;
        const outcome = yield* Effect.result(bus.publish(entry.event));
        if (Result.isFailure(outcome)) {
          const quarantine = entry.attempts + 1 >= maxAttempts;
          yield* outbox.recordFailure(
            entry,
            outcome.failure.message,
            quarantine,
          );
          if (!quarantine) held.add(key);
          continue;
        }
        yield* outbox.markSent(entry);
        sent += 1;
      }
      return sent;
    }).pipe(Effect.orDie);

  return { ...outbox, entries, drain };
};
