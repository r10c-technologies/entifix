import { EntifixBuildError } from '@entifix/core';
import { HttpServerResponse } from 'effect/http';

/**
 * A save refused by a rule the entity's own deserializer does not make — a
 * closed set, a rule over the other records — answered as `status` with
 * `code`, which is what a client translates.
 */
export class EntityRouteRefusal {
  readonly _tag = 'EntityRouteRefusal';

  constructor(
    readonly status: 400 | 409 | 422,
    readonly code: string,
    readonly detail?: string,
  ) {}
}

/** The `500` for anything a route did not anticipate. */
export const routeFailure = (error: unknown) =>
  HttpServerResponse.json(
    { error: 'request failed', code: 'unexpected', detail: String(error) },
    { status: 500 },
  );

/**
 * A domain error may carry its own code (`mediaNotHttps`), so the client can
 * say which rule failed rather than "invalid body".
 */
const refusalCode = (error: EntifixBuildError): string | undefined =>
  'code' in error && typeof error.code === 'string' ? error.code : undefined;

/**
 * The answer to a request the route refused: a `400` for what the client sent
 * wrong, the refusal's own status for a rule a save broke, and a `500` for
 * anything else.
 */
export const invalid = (error: unknown, label: string, code: string) =>
  error instanceof EntifixBuildError
    ? HttpServerResponse.json(
        {
          error: label,
          code: refusalCode(error) ?? code,
          detail: error.message,
        },
        { status: 400 },
      )
    : error instanceof EntityRouteRefusal
      ? HttpServerResponse.json(
          {
            error: 'the record cannot be saved',
            code: error.code,
            ...(error.detail === undefined ? {} : { detail: error.detail }),
          },
          { status: error.status },
        )
      : routeFailure(error);
