import { Schema } from 'effect';

import { defineFailure } from './define.js';

/**
 * The failures every host shares — the ones a framework route, an adapter or a
 * transport raises without knowing the domain it serves. A domain names its
 * own refusals beside these, through the same definers.
 *
 * Each code is permanent: a host's message catalog keys on it.
 */

/** One field a request got wrong. `pointer` locates it, `code` names the rule. */
export const FieldProblem = Schema.Struct({
  pointer: Schema.String,
  detail: Schema.String,
  code: Schema.String,
});
export type FieldProblem = typeof FieldProblem.Type;

/** The request breaks rules on its own; every broken one is listed. */
export class Invalid extends defineFailure('invalid')<Invalid>()(
  'Invalid',
  'invalid',
  { errors: Schema.Array(FieldProblem) },
) {}

/** A list, filter or sort the query language cannot accept. */
export class InvalidQuery extends defineFailure('invalid')<InvalidQuery>()(
  'InvalidQuery',
  'invalidQuery',
  { reason: Schema.String },
  { message: ({ reason }) => reason },
) {}

/**
 * A payload that is not the envelope its reader expected. The sender's fault —
 * a `400` at an HTTP edge and poison on a bus, where redelivering the same
 * bytes produces the same refusal.
 */
export class InvalidEnvelope extends defineFailure(
  'invalid',
)<InvalidEnvelope>()(
  'InvalidEnvelope',
  'invalidEnvelope',
  { reason: Schema.String },
  { message: ({ reason }) => reason },
) {}

/** No credential, or one that does not verify. */
export class Unauthenticated extends defineFailure(
  'unauthenticated',
)<Unauthenticated>()('Unauthenticated', 'unauthenticated') {}

/** A verified caller without the grant. */
export class Forbidden extends defineFailure('forbidden')<Forbidden>()(
  'Forbidden',
  'forbidden',
  // Which grant was missing: diagnostic, not a leak — the caller already
  // knows what it asked to do.
  { permission: Schema.optionalKey(Schema.String) },
) {}

/** The addressed record does not exist. */
export class NotFound extends defineFailure('notFound')<NotFound>()(
  'NotFound',
  'notFound',
  { entity: Schema.optionalKey(Schema.String) },
) {}

/** A write that would duplicate a value the store declares unique. */
export class DuplicateKey extends defineFailure('conflict')<DuplicateKey>()(
  'DuplicateKey',
  'duplicateKey',
  { key: Schema.optionalKey(Schema.String) },
) {}

/** A third party, or a rule over other records, said no. */
export class Declined extends defineFailure('declined')<Declined>()(
  'Declined',
  'declined',
  { reason: Schema.optionalKey(Schema.String) },
  { message: ({ reason }) => reason ?? '' },
) {}

/** Lost a race that a retry can win — a claim taken, a transaction aborted. */
export class Contention extends defineFailure('contention')<Contention>()(
  'Contention',
  'contention',
) {}

/** The dependency asked for less load. Stops retries wherever it appears. */
export class Overloaded extends defineFailure('exhausted')<Overloaded>()(
  'Overloaded',
  'overloaded',
  { retryAfterSeconds: Schema.optionalKey(Schema.Number) },
) {}

/** A dependency could not be reached. */
export class Unavailable extends defineFailure('unavailable')<Unavailable>()(
  'Unavailable',
  'unavailable',
  { dependency: Schema.optionalKey(Schema.String) },
) {}

/** The service a proxy forwards to could not be reached. */
export class UpstreamUnavailable extends defineFailure(
  'unavailable',
)<UpstreamUnavailable>()('UpstreamUnavailable', 'upstreamUnavailable', {
  upstream: Schema.optionalKey(Schema.String),
}) {}

/** A dependency did not answer in time. */
export class Timeout extends defineFailure('timeout')<Timeout>()(
  'Timeout',
  'timeout',
  { dependency: Schema.optionalKey(Schema.String) },
) {}

/**
 * A peer answered something that does not decode — a body that is not a
 * problem, a code nothing registered, a document that does not match its
 * schema.
 */
export class ProtocolFailure extends defineFailure(
  'protocol',
)<ProtocolFailure>()(
  'ProtocolFailure',
  'protocol',
  {
    reason: Schema.String,
    upstreamStatus: Schema.optionalKey(Schema.Number),
  },
  { message: ({ reason }) => reason },
) {}

/** A bug, surfaced as a value. Never carries the bug's text onto a wire. */
export class Internal extends defineFailure('internal')<Internal>()(
  'Internal',
  'internal',
) {}

/** An idempotent route was called without its `Idempotency-Key`. */
export class IdempotencyKeyMissing extends defineFailure(
  'invalid',
)<IdempotencyKeyMissing>()('IdempotencyKeyMissing', 'idempotencyKeyMissing') {}

/** One `Idempotency-Key` arrived with two different payloads. */
export class IdempotencyKeyReused extends defineFailure(
  'declined',
)<IdempotencyKeyReused>()('IdempotencyKeyReused', 'idempotencyKeyReused') {}

/** The first request under this `Idempotency-Key` has not finished. */
export class IdempotencyKeyInFlight extends defineFailure(
  'contention',
)<IdempotencyKeyInFlight>()(
  'IdempotencyKeyInFlight',
  'idempotencyKeyInFlight',
) {}

/**
 * What a store adapter fails with — a datastore, a cache, a bus: the value it
 * guarded already exists, someone else got there first, it could not be
 * reached, it did not answer in time, or it answered something unreadable.
 * A port that talks to storage names this as its failure.
 */
export type StoreFailure =
  DuplicateKey | Contention | Unavailable | Timeout | ProtocolFailure;

/**
 * The technical part of {@link StoreFailure}: the store failing to answer, as
 * opposed to answering no. A unit of work rolls back and surfaces these; a
 * business failure — a `DuplicateKey` included — is its abort.
 */
export type StoreFault = Exclude<StoreFailure, DuplicateKey>;

const STORE_FAULT_TAGS: ReadonlySet<string> = new Set([
  'Contention',
  'Unavailable',
  'Timeout',
  'ProtocolFailure',
]);

/** Whether `value` is a {@link StoreFault}, read by tag. */
export const isStoreFault = (value: unknown): value is StoreFault =>
  typeof value === 'object' &&
  value !== null &&
  STORE_FAULT_TAGS.has((value as { readonly _tag?: unknown })._tag as string);
