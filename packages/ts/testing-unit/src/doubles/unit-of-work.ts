import { type DomainEvent, isStoreFault } from '@entifix/core';
import type { UnitClaim, UnitOfWork } from '@entifix/transactions';
import { Effect, Option, Result } from 'effect';

/**
 * The handle an in-memory unit hands its body: a working copy of the records,
 * which becomes the store only if the unit commits.
 */
export interface InMemoryUnitHandle {
  readonly records: Map<string, unknown>;
}

export interface InMemoryUnitOfWork extends UnitOfWork<InMemoryUnitHandle> {
  /** The committed records. */
  readonly records: ReadonlyMap<string, unknown>;
  /** Every event a committed unit emitted, in commit order. */
  readonly outbox: readonly DomainEvent[];
}

const claimKey = (claim: UnitClaim): string =>
  claim.kind === 'event'
    ? `event:${claim.consumer}:${claim.eventId}`
    : `command:${claim.commandId}`;

/**
 * A {@link UnitOfWork} over plain maps, for testing code that runs units
 * without a database.
 *
 * Atomic the way a real one is: the body writes to a copy, and a body that
 * fails — with a business reason or with a store error — leaves the committed
 * records, the outbox and the claims exactly as they were. Like the Mongo
 * driver fake it is atomicity and not isolation; nothing here runs
 * concurrently, so a race is a `live` test's to prove.
 */
export const makeInMemoryUnitOfWork = (
  seed: Iterable<readonly [string, unknown]> = [],
): InMemoryUnitOfWork => {
  let records = new Map<string, unknown>(seed);
  const outbox: DomainEvent[] = [];
  const eventIds = new Set<string>();
  // A taken claim, and for a command what it is to be answered with.
  const claims = new Map<string, Option.Option<unknown>>();

  const unitOfWork: InMemoryUnitOfWork = {
    get records() {
      return records;
    },
    get outbox() {
      return outbox;
    },

    run: (body, options) =>
      Effect.gen(function* () {
        const key = options?.claim ? claimKey(options.claim) : undefined;
        const taken = key === undefined ? undefined : claims.get(key);
        if (taken !== undefined) {
          return { _tag: 'duplicate' as const, replay: taken };
        }

        const handle: InMemoryUnitHandle = { records: new Map(records) };
        const emitted: DomainEvent[] = [];
        const outcome = yield* Effect.result(
          body({ handle, emit: event => void emitted.push(event) }),
        );

        if (Result.isFailure(outcome)) {
          if (isStoreFault(outcome.failure)) {
            return yield* Effect.fail(outcome.failure);
          }
          return {
            _tag: 'aborted' as const,
            reason: outcome.failure as never,
          };
        }

        // An event id already recorded is the outbox's own idempotency claim:
        // the work it announces has committed before.
        if (emitted.some(event => eventIds.has(event.id))) {
          return { _tag: 'duplicate' as const, replay: Option.none() };
        }

        records = handle.records;
        for (const event of emitted) {
          eventIds.add(event.id);
          outbox.push(event);
        }
        if (key !== undefined) {
          claims.set(
            key,
            options?.replay && options.claim?.kind === 'command'
              ? Option.some(options.replay(outcome.success))
              : Option.none(),
          );
        }

        if (options?.afterCommit) {
          yield* options.afterCommit.pipe(Effect.ignore);
        }
        return { _tag: 'committed' as const, value: outcome.success };
      }),

    replay: commandId =>
      Effect.sync(() =>
        Option.flatten(
          Option.fromUndefinedOr(claims.get(`command:${commandId}`)),
        ),
      ),
  };

  return unitOfWork;
};
