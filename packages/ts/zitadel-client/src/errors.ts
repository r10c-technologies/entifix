import {
  Declined,
  type EntifixFailure,
  isFailure,
  ProtocolFailure,
  Unavailable,
} from '@entifix/core';

/**
 * An answer the provider gave with a status, thrown from inside a request so
 * the catch can tell a refusal from an outage. Private to this package: it
 * never leaves a `catch`.
 */
export class ProviderAnswered extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * What a failed call to the provider means
 * ([ADR 0013](../../../../docs/adr/0013-failures-are-typed-values-decided-at-the-shell.md)):
 * a documented 4xx refusal is the provider saying no, with its reason; a 5xx
 * or a network error is the provider not answering; a body that is not JSON is
 * the provider answering something unreadable.
 */
/** What a call to the provider fails with. */
export type ProviderFailure = Declined | Unavailable | ProtocolFailure;

export const providerFailure = (error: unknown): ProviderFailure => {
  if (isFailure(error)) return error as EntifixFailure as ProviderFailure;
  const shape =
    typeof error === 'object' && error !== null
      ? (error as {
          readonly status?: unknown;
          readonly name?: unknown;
          readonly message?: unknown;
        })
      : {};
  if (
    typeof shape.status === 'number' &&
    shape.status >= 400 &&
    shape.status < 500
  )
    return new Declined({ reason: String(shape.message) });
  if (shape.name === 'SyntaxError')
    return new ProtocolFailure({
      reason: 'the provider answered something that is not JSON',
    });
  return new Unavailable({ dependency: 'zitadel' });
};
