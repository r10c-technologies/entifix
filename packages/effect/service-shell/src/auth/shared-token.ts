import { timingSafeEqual } from 'node:crypto';

import { Effect } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';

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
const matches = (provided: string | undefined, expected: string): boolean => {
  if (provided === undefined) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  // `timingSafeEqual` throws on a length mismatch, so the lengths are compared
  // first — the length of a shared secret is not what protects it.
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Serves `route` only to a caller presenting the shared token.
 *
 * ⚠️ This is **not** identity: every caller presents the same value, so it
 * proves membership of whatever group holds the secret and nothing more. It is
 * the right shape for a route whose readers are machines — a fleet fetching its
 * configuration at boot, tooling reading a service's wiring — and the wrong one
 * for anything a person or a browser reaches.
 *
 * Health endpoints should stay unguarded: a probe cannot hold a credential, and
 * a readiness check that needs one becomes an authentication problem.
 */
export const requireSharedToken =
  (shared: SharedToken) =>
  <A, E, R>(route: Effect.Effect<A, E, R>) =>
    // The return type is inferred rather than written out: `HttpServerResponse.json`
    // contributes an `HttpBodyError` to the failure channel, and spelling the type
    // out while omitting it is what makes `tsc` refuse the declaration emit.
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;

      if (!matches(request.headers[shared.header], shared.token())) {
        return yield* HttpServerResponse.json(
          { error: 'unauthenticated', code: 'unauthenticated' },
          { status: 401 },
        );
      }

      return yield* route;
    });
