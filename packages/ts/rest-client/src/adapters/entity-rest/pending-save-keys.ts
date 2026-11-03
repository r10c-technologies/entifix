/**
 * The `Idempotency-Key` each entity's pending save was sent under, kept until
 * that save is answered.
 *
 * Keyed by the entity instance, so a save called again on the same object
 * after a network error — the case the key exists for — sends the same key and
 * the service replays its first answer instead of writing twice. An answered
 * save forgets its key, so the next edit of that object is a new request. The
 * browser itself never retries (ADR 0014); this is what makes a person's retry
 * safe.
 */
export const pendingSaveKeys = new WeakMap<object, string>();
