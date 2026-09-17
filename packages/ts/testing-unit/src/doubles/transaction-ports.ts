import {
  type DomainEvent,
  EntifixConnError,
  type EntifixError,
  EntifixLockError,
  matchesEventPattern,
} from '@entifix/core';
import type {
  EventBus,
  LockHandle,
  LockService,
  SagaInstance,
  SagaStore,
  SequenceService,
  TransactionInbox,
} from '@entifix/transactions';
import { Effect } from 'effect';

export interface InMemoryLockService extends LockService {
  /** Keys currently held, in acquisition order. */
  readonly held: string[];
  /** Every acquire/release in the order it happened. */
  readonly log: ReadonlyArray<{ action: 'acquire' | 'release'; key: string }>;
  /**
   * Marks `key` as already taken by someone else, so the next `acquire` fails
   * with {@link EntifixLockError} — the 409 path of the transaction facade.
   */
  contendOn(key: string): void;
}

/**
 * In-memory {@link LockService}. Acquisition is immediate and uncontended
 * unless {@link InMemoryLockService.contendOn} says otherwise, and `release`
 * only frees a lock whose token matches — the compare-and-delete rule the Redis
 * adapter enforces with a Lua script.
 */
export const makeInMemoryLockService = (): InMemoryLockService => {
  const tokens = new Map<string, string>();
  const contended = new Set<string>();
  const log: Array<{ action: 'acquire' | 'release'; key: string }> = [];
  let counter = 0;

  return {
    acquire: key =>
      Effect.suspend(() => {
        if (contended.has(key) || tokens.has(key)) {
          return Effect.fail(
            new EntifixLockError(`Could not acquire lock "${key}"`, undefined, {
              key,
            }),
          );
        }
        const token = `token-${(counter += 1)}`;
        tokens.set(key, token);
        log.push({ action: 'acquire', key });
        return Effect.succeed({ key, token });
      }),
    release: (handle: LockHandle) =>
      Effect.sync(() => {
        if (tokens.get(handle.key) === handle.token) {
          tokens.delete(handle.key);
          log.push({ action: 'release', key: handle.key });
        }
      }),
    get held() {
      return [...tokens.keys()];
    },
    get log() {
      return log;
    },
    contendOn: key => {
      contended.add(key);
    },
  };
};

export interface InMemorySequenceService extends SequenceService {
  /** The current value of every sequence drawn from so far. */
  readonly values: Readonly<Record<string, number>>;
}

/**
 * In-memory {@link SequenceService} — a plain counter per name. Atomicity is
 * what the Redis `INCR` adapter buys; single-threaded JS gives it for free here.
 */
export const makeInMemorySequenceService = (): InMemorySequenceService => {
  const sequences = new Map<string, number>();

  return {
    next: name =>
      Effect.sync(() => {
        const next = (sequences.get(name) ?? 0) + 1;
        sequences.set(name, next);
        return next;
      }),
    get values() {
      return Object.fromEntries(sequences);
    },
  };
};

export interface RecordingEventBus extends EventBus {
  /** Every event published, in order. */
  readonly published: DomainEvent[];
  /**
   * Pushes an event to the subscribers whose pattern matches it, as a topic
   * exchange would. Deliberately not "to all subscribers": routing is the
   * broker's job in production, so a double that ignored it would let a
   * consumer pass its tests while receiving traffic it never bound to.
   */
  deliver(event: DomainEvent): Effect.Effect<void, EntifixError>;
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
    handle: (event: DomainEvent) => Effect.Effect<void, EntifixError>;
  }> = [];
  let failNext = false;

  return {
    publish: event =>
      Effect.suspend(() => {
        if (failNext) {
          failNext = false;
          return Effect.fail(
            new EntifixConnError('Event bus unavailable', undefined, {
              eventId: event.id,
            }),
          );
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

export interface InMemorySagaStore extends SagaStore {
  /** Every instance, as stored — for a spec to assert on state, not calls. */
  readonly instances: readonly SagaInstance[];
}

/**
 * In-memory {@link SagaStore}, with the Mongo adapter's semantics: `start`
 * never overwrites, outcomes append, and a resume claim only takes an
 * unfinished instance whose `updatedAt` is past the deadline — counting the
 * attempt and re-stamping it, so the next sweep does not find it again.
 */
export const makeInMemorySagaStore = (): InMemorySagaStore => {
  const instances = new Map<string, SagaInstance>();
  const stamp = () => new Date().toISOString();
  const unfinished = (entry: SagaInstance) =>
    entry.state === 'RUNNING' || entry.state === 'COMPENSATING';
  const pastDeadline = (entry: SagaInstance, olderThanMs: number) =>
    entry.updatedAt < new Date(Date.now() - olderThanMs).toISOString();
  const update = (
    sagaId: string,
    change: (entry: SagaInstance) => SagaInstance,
  ) =>
    Effect.sync(() => {
      const current = instances.get(sagaId);
      if (current !== undefined) {
        instances.set(sagaId, { ...change(current), updatedAt: stamp() });
      }
    });

  return {
    start: started =>
      Effect.sync(() => {
        if (!instances.has(started.sagaId)) {
          instances.set(started.sagaId, { ...started, updatedAt: stamp() });
        }
      }),
    beginStep: (sagaId, stepIndex) =>
      update(sagaId, entry => ({ ...entry, stepIndex })),
    recordOutcome: (sagaId, outcome) =>
      update(sagaId, entry => ({
        ...entry,
        outcomes: [...entry.outcomes, outcome],
      })),
    settle: (sagaId, state, error) =>
      update(sagaId, entry => ({ ...entry, state, error })),
    markCompensated: (sagaId, stepId) =>
      update(sagaId, entry => ({
        ...entry,
        outcomes: entry.outcomes.map(outcome =>
          outcome.stepId === stepId
            ? { ...outcome, compensated: true }
            : outcome,
        ),
      })),
    get: sagaId => Effect.sync(() => instances.get(sagaId)),
    findStale: olderThanMs =>
      Effect.sync(() =>
        [...instances.values()].filter(
          entry => unfinished(entry) && pastDeadline(entry, olderThanMs),
        ),
      ),
    claimForResume: (sagaId, olderThanMs) =>
      Effect.sync(() => {
        const current = instances.get(sagaId);
        if (
          current === undefined ||
          !unfinished(current) ||
          !pastDeadline(current, olderThanMs)
        ) {
          return undefined;
        }
        const claimed = {
          ...current,
          resumeAttempts: current.resumeAttempts + 1,
          updatedAt: stamp(),
        };
        instances.set(sagaId, claimed);
        return claimed;
      }),
    get instances() {
      return [...instances.values()];
    },
  };
};
