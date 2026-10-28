import {
  isFailure,
  type StoreFailure,
  Timeout,
  Unavailable,
} from '@entifix/core';

/**
 * What an ioredis error means, as a categorised failure
 * ([ADR 0013](../../../../../docs/adr/0013-failures-are-typed-values-decided-at-the-shell.md)).
 * Read by name and message, never by class.
 *
 * Redis has no uniqueness a caller can collide with and no transactions that
 * conflict, so there is no `conflict` or `contention` here: the server either
 * answered, did not answer in time, or could not be reached.
 */
export const translateRedisError = (
  error: unknown,
  dependency = 'redis',
): StoreFailure => {
  if (isFailure(error)) return error as StoreFailure;
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : '';
  return /timed? ?out/i.test(message)
    ? new Timeout({ dependency })
    : new Unavailable({ dependency });
};
