import type { StoreFailure } from '@entifix/core';
import { Context, Effect } from 'effect';

/**
 * A consumer's claim on one delivered message.
 *
 * The mirror of an {@link OutboxEntry}: the outbox makes a publisher's event
 * survive a broker outage, the inbox makes a consumer's side effect survive a
 * redelivery. Each end owns one unique index, and the value in it is the same
 * `event.id`.
 */
export interface InboxClaim {
  /**
   * Which consumer claimed it — the subscription's durable work-queue name
   * (`<slice>.<pattern>`).
   *
   * **Half of the key, and the half that is easy to leave out.** Two consumers
   * legitimately process the same event: the saga tracker's fold and the SSE
   * hub both bind `transaction.*` today. Keyed on `eventId` alone, whichever
   * claimed first would starve the other of every message — a consumer that
   * silently stops working while the broker, the queue and the handler all
   * report success.
   */
  consumer: string;
  /**
   * The message's own id, which for a transaction step is
   * `<transactionId>:<step>`.
   *
   * Never `correlationId`: one transaction emits up to three messages, so
   * keying on the correlation id would make `completed` look like a
   * redelivery of `accepted`.
   */
  eventId: string;
  /** ISO-8601, for retention — nothing reads it to make a decision. */
  claimedAt: string;
}

/**
 * Whether {@link TransactionInbox.claim} actually wrote.
 *
 * `duplicate` is not a failure — it is how a **redelivery** is recognised, the
 * same way `OutboxEnqueueResult`'s `duplicate` recognises a replayed command.
 * Delivery is at-least-once by construction (a crash between `publish` and
 * `markSent` re-sends), so a consumer seeing this should skip its side effect
 * and ack, not error.
 */
export type InboxClaimResult = 'claimed' | 'duplicate';

/**
 * The consumer-side half of exactly-once processing over an at-least-once bus.
 *
 * A claim is only worth anything if it is written **in the same storage
 * transaction as the side effect it guards**. Claim-then-act leaves a crash
 * window in which the claim is taken and the effect never ran, so the
 * redelivery is skipped and the work is lost — strictly worse than doing it
 * twice.
 *
 * There is deliberately **no `claimWithin(session)` here**, for the reason
 * {@link Outbox} states about `enqueueWithin`: a driver session may
 * not enter a framework-free contract. A claim that must commit with its side
 * effect is a {@link UnitOfWork}'s `event` claim (ADR 0009); this port is what
 * a consumer that can claim standalone uses instead.
 *
 * It follows that **the inbox lives with the side effect, not in one central
 * place**: the claim and the write must be in the same database to be one fact.
 * The outbox is per-tenant because the entity is; the saga tracker's inbox is in
 * the `saga` database because that is where its fold writes.
 */
export interface TransactionInbox {
  /**
   * Claim an event for this consumer. Idempotent per `(consumer, eventId)`.
   *
   * Answering `duplicate` means some earlier delivery already ran the side
   * effect to completion, because the claim and the effect commit together.
   */
  claim(eventId: string): Effect.Effect<InboxClaimResult, StoreFailure>;
}

export class TransactionInboxTag extends Context.Service<
  TransactionInboxTag,
  TransactionInbox
>()('TransactionInboxTag') {}

/**
 * Whether a consumer should discard an event because it already applied this
 * version of its aggregate, or a later one
 * ([ADR 0018](../../../../../docs/adr/0018-one-outbox-ordered-per-aggregate.md)).
 *
 * The bus redelivers and reorders; with a version per aggregate a late
 * `v = n - 1` never overwrites `v = n`, and a delete is ordered like any other
 * write. `applied` is what the consumer stored the last time it applied this
 * aggregate — absent when it never has.
 */
export const isStale = (
  applied: number | undefined,
  version: number,
): boolean => applied !== undefined && version <= applied;

/**
 * Applies `apply` unless the event is stale, reading what the consumer last
 * applied for its aggregate with `applied`. Answers `'stale'` for a discarded
 * event, so the caller can count it rather than wonder.
 */
export const discardIfStale = <A, E, R, E2, R2>(
  applied: Effect.Effect<number | undefined, E, R>,
  version: number,
  apply: Effect.Effect<A, E2, R2>,
): Effect.Effect<A | 'stale', E | E2, R | R2> =>
  Effect.flatMap(applied, (last): Effect.Effect<A | 'stale', E2, R2> =>
    isStale(last, version) ? Effect.succeed('stale' as const) : apply,
  );
