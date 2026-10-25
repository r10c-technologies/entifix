import type { DomainEvent, EntifixConnError } from '@entifix/core';
import type { Effect, Option } from 'effect';

/**
 * What a unit of work deduplicates on, if anything. At most one per unit.
 *
 * Two kinds, because there are two directions a duplicate arrives from:
 *
 * - `event` — a consumer folding a bus message. Keyed on `(consumer, eventId)`,
 *   the inbox's compound key: two consumers legitimately process one event,
 *   and a key on `eventId` alone would let whichever claimed first starve the
 *   other.
 * - `command` — a participant answering a dispatched command. Keyed on the
 *   command id alone, and it **remembers an answer**: a redelivered command must
 *   be told what the first delivery decided, not that it was a duplicate.
 */
export type UnitClaim =
  | {
      readonly kind: 'event';
      readonly consumer: string;
      readonly eventId: string;
    }
  | { readonly kind: 'command'; readonly commandId: string };

/**
 * The view a unit's body gets of the transaction it runs in.
 *
 * `handle` is the store's own — a driver session and the database it is bound
 * to, for Mongo. It is opaque to this package on purpose: the contract states
 * what commits together, and only the adapter that implements it (and the
 * persistence code written against that adapter) ever looks inside.
 */
export interface Unit<H> {
  readonly handle: H;
  /**
   * Record an event to publish **if and only if** the unit commits.
   *
   * Recorded, not published. The adapter writes it to the outbox inside the
   * same transaction, so the state change and its announcement are one fact,
   * and the relay carries it to the bus afterwards.
   */
  emit(event: DomainEvent): void;
}

/**
 * How a unit ended. A failure of the store itself is not one of these — it is
 * the `EntifixConnError` in the error channel of {@link UnitOfWork.run}.
 *
 * - `committed` — every write, every event and the claim are durable.
 * - `duplicate` — the claim was already taken, so the body's work had already
 *   committed once. Nothing was written. `replay` is what the first run asked
 *   to be remembered (`command` claims only).
 * - `aborted` — the body failed with a business reason. Nothing was written.
 *   This is how a refusal leaves a unit: as a typed value, never as a thrown
 *   sentinel caught three frames up.
 */
export type UnitOutcome<A, E> =
  | { readonly _tag: 'committed'; readonly value: A }
  | { readonly _tag: 'duplicate'; readonly replay: Option.Option<unknown> }
  | { readonly _tag: 'aborted'; readonly reason: E };

export interface UnitRunOptions<A, R = never> {
  readonly claim?: UnitClaim;
  /**
   * What a later duplicate of this `command` claim is answered with, derived
   * from the committed value. Stored with the claim, in the same transaction.
   *
   * It must be JSON: it is written to the store and read back by a different
   * process, possibly after a restart.
   */
  readonly replay?: (value: A) => unknown;
  /**
   * Runs once the unit has committed, and never otherwise — the place to drain
   * the outbox inline so the event leaves now rather than at the next sweep.
   *
   * Its failure does not undo the commit, and is not reported as the unit's: a
   * drain that fails here is retried by the sweep, which is exactly the
   * fallback the outbox exists to provide.
   */
  readonly afterCommit?: Effect.Effect<void, unknown, R>;
}

/**
 * One storage transaction that the outbox, the inbox and a command claim all
 * join: domain writes, zero or more events, and at most one claim, which commit
 * or vanish together.
 *
 * The body may run **more than once**. A store that retries a transient
 * conflict re-runs it from the start, so the body must be a pure function of
 * its inputs and the handle — no clock read that has to match a value already
 * returned, no call to another service, no counter drawn from outside the
 * store. Do those before the unit and pass the results in.
 *
 * The body's typed failure is the abort: `run` rolls back and answers
 * `aborted` with it. An `EntifixConnError` is the exception — the store failing
 * is not a business decision, so it rolls back and surfaces in `run`'s own
 * error channel instead.
 *
 * Reads through the handle see the unit's own uncommitted writes.
 */
export interface UnitOfWork<H> {
  run<A, E, R>(
    body: (unit: Unit<H>) => Effect.Effect<A, E, R>,
    options?: UnitRunOptions<A, R>,
  ): Effect.Effect<
    UnitOutcome<A, Exclude<E, EntifixConnError>>,
    EntifixConnError,
    R
  >;
  /**
   * What the run that took this `command` claim asked to be remembered, or
   * `none` if no run has taken it — for a caller that has to answer a duplicate
   * outside a unit.
   */
  replay(
    commandId: string,
  ): Effect.Effect<Option.Option<unknown>, EntifixConnError>;
}
