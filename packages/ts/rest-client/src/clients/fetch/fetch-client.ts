import {
  currentRemainingMs,
  DEADLINE_HEADER,
  decodeProblem,
  type EntifixFailure,
  Overloaded,
  PROBLEM_CONTENT_TYPE,
  ProtocolFailure,
  Timeout,
  Unavailable,
} from '@entifix/core';
import { Effect } from 'effect';

import { HttpRequest, HttpResponse } from '../types.js';

/** The host a request went to, which is what a failure names as its dependency. */
const dependencyOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * The failure a non-2xx answer carries. `Retry-After` in seconds is copied
 * onto an `Overloaded` that did not say itself when to come back.
 */
const failureOf = (response: Response, request: HttpRequest<unknown>) =>
  Effect.gen(function* () {
    const text = yield* Effect.promise(() => response.text());
    const isProblem =
      response.headers.get('content-type')?.startsWith(PROBLEM_CONTENT_TYPE) ===
      true;
    if (!isProblem)
      return new ProtocolFailure({
        reason: `${request.method} ${request.url} answered ${String(response.status)} without a problem body`,
        upstreamStatus: response.status,
      }) as EntifixFailure;

    const failure = decodeProblem(parseOr(text), response.status);
    const retryAfter = Number(response.headers.get('retry-after'));
    return failure._tag === 'Overloaded' &&
      !('retryAfterSeconds' in failure) &&
      Number.isFinite(retryAfter) &&
      retryAfter > 0
      ? new Overloaded({ retryAfterSeconds: retryAfter })
      : failure;
  });

const parseOr = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

export const performHttpRequestThroughFetch = <TResponseBody>(
  request: HttpRequest<unknown>,
) =>
  Effect.gen(function* () {
    // The caller's remaining budget travels on, minus what is already spent,
    // and a budget already spent is not worth a round trip (ADR 0014).
    const remaining = yield* currentRemainingMs;
    if (remaining === 0)
      return yield* Effect.fail(new Timeout({ dependency: request.url }));

    // The signal is tied to this fiber: a caller that goes away interrupts it,
    // and the request below is aborted rather than left to finish.
    const response = yield* Effect.tryPromise({
      try: signal =>
        fetch(request.url, {
          method: request.method,
          headers: {
            ...request.headers,
            ...(remaining === undefined
              ? {}
              : { [DEADLINE_HEADER]: String(remaining) }),
          },
          body: request.body ? JSON.stringify(request.body) : undefined,
          signal,
        }),
      // Only reached without an answer: a network error or a refused
      // connection. An interruption aborts through the signal instead.
      catch: () => new Unavailable({ dependency: dependencyOf(request.url) }),
    });

    // A failure answers as the failure that was sent: a problem body decodes
    // into its registered class with its typed fields, so a business `409`
    // reaches the browser as the refusal it is and never as a connection
    // error. A body that is not a problem — a proxy's, a host route that still
    // writes its own — decodes as `ProtocolFailure` carrying the status.
    if (!response.ok) {
      return yield* Effect.fail(yield* failureOf(response, request));
    }

    const body = yield* Effect.tryPromise({
      try: () => response.json() as Promise<TResponseBody>,
      catch: () =>
        new ProtocolFailure({
          reason: `${request.method} ${request.url} answered a body that is not JSON`,
          upstreamStatus: response.status,
        }),
    });

    // Return the HttpResponse object
    const httpResponse: HttpResponse<TResponseBody> = {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };

    return httpResponse;
  });
