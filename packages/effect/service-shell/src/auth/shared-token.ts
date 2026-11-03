import { timingSafeEqual } from 'node:crypto';

/**
 * A secret every caller of a route presents in one header.
 *
 * Both halves are the host's. Which header carries it and where the expected
 * value comes from are a deployment's conventions — a fleet-wide environment
 * variable, a mounted secret, a fixed value in a test — so the framework takes
 * them as values rather than naming either.
 */
export interface SharedToken {
  /** The request header the token travels in, e.g. `x-service-token`. */
  readonly header: string;
  /**
   * The expected token, asked for on each request rather than captured once —
   * so a rotated secret, or a test that sets one, takes effect without a
   * restart.
   */
  readonly token: () => string;
}

/** Constant-time comparison, so the token cannot be recovered byte by byte. */
export const tokenMatches = (
  provided: string | undefined,
  expected: string,
): boolean => {
  // An empty credential is refused outright, on either side: two empty
  // buffers compare equal, so an unset secret would admit an empty header.
  if (provided === undefined || provided === '' || expected === '')
    return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  // `timingSafeEqual` throws on a length mismatch, so the lengths are compared
  // first — the length of a shared secret is not what protects it.
  return left.length === right.length && timingSafeEqual(left, right);
};
