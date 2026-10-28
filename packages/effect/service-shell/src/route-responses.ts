import {
  defaultStatus,
  EntifixBuildError,
  EntifixConnError,
  type EntifixFailure,
  failureTypeUri,
  isFailure,
  PROBLEM_CONTENT_TYPE,
  Unavailable,
} from '@entifix/core';
import { Effect } from 'effect';
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

/**
 * The `500` for anything a route did not anticipate.
 *
 * @deprecated A route mounted through `mountRoutes` answers through `respond`,
 * which never writes `String(error)`. Kept for a host's unmigrated routes and
 * removed with the class tree.
 */
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
 * @deprecated A route mounted through `mountRoutes` fails with typed failures
 * and lets `respond` answer them. Kept for a host's unmigrated routes and
 * removed with the class tree.
 *
 * The answer to a request the route refused: a `400` for what the client sent
 * wrong, the refusal's own status for a rule a save broke, a business-family
 * failure's category status, and a `500` for anything else.
 */
export const invalid = (error: unknown, label: string, code: string) =>
  isFailure(error) && error.family === 'business'
    ? HttpServerResponse.json(
        {
          error: label,
          // A body that is not an envelope is the route's own refusal, named
          // by the route as it always was; any other failure names itself.
          code: error._tag === 'InvalidEnvelope' ? code : error.code,
          ...(error.message === '' ? {} : { detail: error.message }),
        },
        { status: defaultStatus(error.category) },
      )
    : error instanceof EntifixBuildError
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

const LEGACY_CATEGORY: Record<
  EntityRouteRefusal['status'],
  'invalid' | 'conflict' | 'declined'
> = {
  400: 'invalid',
  409: 'conflict',
  422: 'declined',
};

/**
 * A problem body for a refusal whose code no failure class registered — a
 * host's `EntityRouteRefusal`, a domain `EntifixBuildError` carrying its own
 * code. Written by hand because there is no class to encode it through; a
 * client that decodes it sees an unknown code until the refusal becomes a
 * failure of its own.
 */
const legacyProblem = (
  status: EntityRouteRefusal['status'],
  code: string,
  detail?: string,
) =>
  HttpServerResponse.text(
    JSON.stringify({
      type: failureTypeUri(code),
      title: code,
      status,
      code,
      category: LEGACY_CATEGORY[status],
      ...(detail === undefined ? {} : { detail }),
    }),
    { status, contentType: PROBLEM_CONTENT_TYPE },
  );

/**
 * What a framework route's errors mean, while some still arrive as the old
 * class tree: a typed failure passes through to `respond`, a refusal answers
 * as its own problem body, an unreachable store becomes `Unavailable`, and
 * anything else is a defect — the opaque `500`, logged where `respond`
 * catches it.
 *
 * @param fallbackCode the code a domain error carrying none answers with.
 */
export const legacyAnswer =
  (fallbackCode: string) =>
  (
    error: unknown,
  ): Effect.Effect<HttpServerResponse.HttpServerResponse, EntifixFailure> =>
    isFailure(error)
      ? Effect.fail(error)
      : error instanceof EntityRouteRefusal
        ? Effect.succeed(legacyProblem(error.status, error.code, error.detail))
        : error instanceof EntifixBuildError
          ? Effect.succeed(
              legacyProblem(
                400,
                refusalCode(error) ?? fallbackCode,
                error.message,
              ),
            )
          : error instanceof EntifixConnError
            ? Effect.fail(new Unavailable({}))
            : Effect.die(error);
