import {
  type DomainEvent,
  type EntifixFailure,
  matchesEventPattern,
  Unavailable,
} from '@entifix/core';
import type { EventBus, TransactionInbox } from '@entifix/transactions';
import { Effect } from 'effect';

export interface RecordingEventBus extends EventBus {
  /** Every event published, in order. */
  readonly published: DomainEvent[];
  /**
   * Pushes an event to the subscribers whose pattern matches it, as a topic
   * exchange would. Deliberately not "to all subscribers": routing is the
   * broker's job in production, so a double that ignored it would let a
   * consumer pass its tests while receiving traffic it never bound to.
   */
  deliver(event: DomainEvent): Effect.Effect<void, EntifixFailure>;
  /** Makes the next `publish` fail, for the broker-unavailable branch. */
  failNextPublish(): void;
}

/**
 * In-memory {@link EventBus} that records what was published rather than
 * asserting on it. Prefer reading `bus.published` in a test over a mock's call
 * assertions: the expectation then reads as state, not as a spy protocol.
 */
export const makeRecordingEventBus = (): RecordingEventBus => {
  const published: DomainEvent[] = [];
  const handlers: Array<{
    pattern: string;
    handle: (event: DomainEvent) => Effect.Effect<void, EntifixFailure>;
  }> = [];
  let failNext = false;

  return {
    publish: event =>
      Effect.suspend(() => {
        if (failNext) {
          failNext = false;
          return Effect.fail(new Unavailable({ dependency: 'bus' }));
        }
        published.push(event);
        return Effect.void;
      }),
    subscribe: (subscription, handle) =>
      Effect.sync(() => {
        // Only the pattern is retained: queue durability and the delivery
        // ceiling are broker facts with no in-memory analogue, and faking them
        // would assert against the double rather than against a broker.
        handlers.push({ pattern: subscription.pattern, handle });
      }),
    deliver: event =>
      Effect.forEach(
        handlers.filter(({ pattern }) =>
          matchesEventPattern(pattern, event.name),
        ),
        ({ handle }) => handle(event),
        { discard: true },
      ),
    get published() {
      return published;
    },
    failNextPublish: () => {
      failNext = true;
    },
  };
};

/**
 * An in-memory {@link TransactionInbox}, one per consumer, over a shared claim
 * set.
 *
 * Sharing the set across the inboxes one factory hands out is what makes the
 * contract's "one consumer cannot consume another's claim" case a real
 * assertion, rather than one the double satisfies by only ever having seen a
 * single consumer.
 */
export const makeInMemoryInboxes = () => {
  const claimed = new Set<string>();

  return {
    /** An inbox for `consumer`, over the shared claim set. */
    for: (consumer: string): TransactionInbox => ({
      claim: eventId =>
        Effect.sync(() => {
          const key = JSON.stringify([consumer, eventId]);
          if (claimed.has(key)) return 'duplicate' as const;
          claimed.add(key);
          return 'claimed' as const;
        }),
    }),
    get claims(): readonly { consumer: string; eventId: string }[] {
      return [...claimed].map(key => {
        const [consumer, eventId] = JSON.parse(key) as [string, string];
        return { consumer, eventId };
      });
    },
  };
};
