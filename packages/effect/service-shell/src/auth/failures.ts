import { Failure } from '@entifix/core';
import { Effect } from 'effect';
import type { HttpServerResponse } from 'effect/http';

import { problemResponse } from '../respond.js';

/**
 * A signed-in caller whose session names no organization, on a route that acts
 * for one. A member of several organizations hits it before choosing one; the
 * code is what a client renders as "select an organization" instead of
 * "forbidden".
 */
export class NoActiveOrganization extends Failure.conflict<NoActiveOrganization>()(
  'NoActiveOrganization',
  'noActiveOrganization',
) {}

/**
 * A guard's refusal, answered as the problem body \`respond\` would write.
 *
 * ⚠️ The guards answer rather than fail because a host's routes that are not
 * yet mounted through \`mountRoutes\` would otherwise meet an unhandled typed
 * failure where they used to meet a \`401\`. The wire is the same either way;
 * the guard functions go when the endpoint router replaces them.
 */
export const refuse = (
  failure: Parameters<typeof problemResponse>[0],
): Effect.Effect<HttpServerResponse.HttpServerResponse> =>
  Effect.succeed(problemResponse(failure));
