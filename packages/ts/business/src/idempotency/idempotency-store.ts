import type { StoreFailure } from '@entifix/core';
import { Context, type Effect } from 'effect';

/** A response as it is replayed: status, content type and body text. */
export interface StoredResponse {
  readonly status: number;
  readonly contentType?: string;
  readonly body: string;
}

/**
 * One request's claim on its `Idempotency-Key`. The dedup key is the caller,
 * the route and the key together, so two callers — or two routes — choosing
 * the same key never collide; the fingerprint is what tells a retry from a
 * different request reusing a key.
 */
export interface IdempotencyRecord {
  readonly dedupKey: string;
  readonly fingerprint: string;
  readonly state: 'inFlight' | 'completed';
  readonly response?: StoredResponse;
  /** ISO-8601. Past it, the record is treated as absent. */
  readonly expiresAt: string;
}

/** What a claim found: nothing, so this request owns the key, or a live record. */
export type IdempotencyClaim =
  | { readonly _tag: 'claimed' }
  | { readonly _tag: 'existing'; readonly record: IdempotencyRecord };

/**
 * Where a route remembers the requests it has answered under an
 * `Idempotency-Key` — what makes a redelivered command, or a client's retry,
 * answer what the first one did instead of acting twice.
 *
 * Retention is the implementation's, passed by the composition root: a record
 * is kept until `expiresAt`, and an expired one is treated as never written.
 */
export interface IdempotencyStore {
  /** Claims `dedupKey` atomically: exactly one concurrent caller gets `claimed`. */
  readonly claim: (
    dedupKey: string,
    fingerprint: string,
  ) => Effect.Effect<IdempotencyClaim, StoreFailure>;
  /** Records the answer, so a completed duplicate replays it. */
  readonly complete: (
    dedupKey: string,
    response: StoredResponse,
  ) => Effect.Effect<void, StoreFailure>;
  /**
   * Gives the key back after a failure that was not an answer — an outage —
   * so a retry is allowed to try again rather than being told it is in flight.
   */
  readonly release: (dedupKey: string) => Effect.Effect<void, StoreFailure>;
}

export class IdempotencyStoreTag extends Context.Service<
  IdempotencyStoreTag,
  IdempotencyStore
>()('@entifix/business/IdempotencyStore') {}
