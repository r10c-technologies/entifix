import { Effect } from 'effect';

/**
 * A credential that lets whoever holds it watch one flow, with no session: the
 * anonymous buyer behind a storefront checkout. The nonce goes to the holder;
 * only its SHA-256 digest is stored and put in the flow's audience, so the
 * record is the authority and the credential is inert anywhere else.
 */
export interface FlowCapability {
  readonly nonce: string;
  readonly digest: string;
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

/** The SHA-256 digest of a nonce, as hex. Web Crypto, so it runs in a browser too. */
export const digestFlowCapability = (nonce: string): Effect.Effect<string> =>
  Effect.promise(() =>
    globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce)),
  ).pipe(Effect.map(buffer => hex(new Uint8Array(buffer))));

/** Mints a fresh capability: 32 random bytes, and their digest. */
export const makeFlowCapability = (): Effect.Effect<FlowCapability> =>
  Effect.suspend(() => {
    const nonce = hex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
    return Effect.map(digestFlowCapability(nonce), digest => ({
      nonce,
      digest,
    }));
  });

/**
 * Compares two digests in time independent of where they first differ. A
 * length mismatch answers at once: a digest's length is no secret.
 */
const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1)
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
};

/**
 * Whether `nonce` is the capability whose digest is `digest`. An empty nonce is
 * refused outright; otherwise the comparison is constant-time, so the answer's
 * timing says nothing about how close a guess was.
 */
export const verifyFlowCapability = (
  nonce: string,
  digest: string,
): Effect.Effect<boolean> =>
  nonce === ''
    ? Effect.succeed(false)
    : Effect.map(digestFlowCapability(nonce), computed =>
        constantTimeEqual(computed, digest),
      );
