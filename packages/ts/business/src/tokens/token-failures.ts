import { Failure, Unavailable } from '@entifix/core';

/**
 * A token whose signature, algorithm, issuer, audience or shape does not
 * verify. The caller has to sign in again; retrying sends the same token.
 */
export class InvalidToken extends Failure.unauthenticated<InvalidToken>()(
  'InvalidToken',
  'invalidToken',
) {}

/** A token that verified once and has since expired. */
export class ExpiredToken extends Failure.unauthenticated<ExpiredToken>()(
  'ExpiredToken',
  'expiredToken',
) {}

/** Why a token did not verify, as a host can act on it. */
export type TokenFailure = InvalidToken | ExpiredToken | Unavailable;

const JWKS_UNREACHABLE = new Set([
  'ERR_JWKS_TIMEOUT',
  'ERR_JWKS_NO_MATCHING_KEY',
]);

/**
 * A verification error from `jose`, read by its `code` and never by class:
 * expiry is its own answer, a key set that could not be fetched is the
 * provider being unreachable, and everything else is a token that does not
 * verify. `ERR_JWKS_NO_MATCHING_KEY` counts as unreachable because a key
 * rotation the cache has not caught up with clears on the next fetch.
 */
export const tokenFailureFrom = (
  error: unknown,
  dependency = 'jwks',
): TokenFailure => {
  const shape =
    typeof error === 'object' && error !== null
      ? (error as { readonly code?: unknown; readonly name?: unknown })
      : {};
  if (shape.code === 'ERR_JWT_EXPIRED') return new ExpiredToken();
  if (
    (typeof shape.code === 'string' && JWKS_UNREACHABLE.has(shape.code)) ||
    shape.name === 'TypeError'
  )
    return new Unavailable({ dependency });
  return new InvalidToken();
};
