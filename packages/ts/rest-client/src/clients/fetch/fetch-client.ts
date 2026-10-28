import {
  currentRemainingMs,
  DEADLINE_HEADER,
  EntifixConnError,
  Timeout,
} from '@entifix/core';
import { Effect } from 'effect';

import { HttpRequest, HttpResponse } from '../types.js';

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
      catch: error =>
        new EntifixConnError(`HTTP request to ${request.url} failed`, error, {
          url: request.url,
          method: request.method,
        }),
    });

    // Check if the response is successful (status code 2xx)
    if (!response.ok) {
      // Services answer a failure with `{ error, code, detail }`. Carrying the
      // `code` into `details` is what lets the browser render a translated
      // message instead of the service's English `error` string. A body that is
      // not JSON is not itself a failure — the status already is one.
      const failure = yield* Effect.promise(() =>
        response.json().then(
          (parsed: unknown) => parsed as Record<string, unknown>,
          () => ({}) as Record<string, unknown>,
        ),
      );
      const code = failure['code'];

      yield* Effect.fail(
        new EntifixConnError(
          `HTTP request failed with status ${response.status}: ${response.statusText}`,
          undefined,
          {
            status: response.status,
            statusText: response.statusText,
            url: request.url,
            method: request.method,
            ...(typeof code === 'string' ? { code } : {}),
          },
        ),
      );
    }

    // Parse the response body as JSON. If parse fails, fail with an EntifixExternalError with details about the failure.
    const body = yield* Effect.tryPromise({
      try: () => response.json() as Promise<TResponseBody>,
      catch: error =>
        new EntifixConnError('Failed to parse response body as JSON', error, {
          url: request.url,
          method: request.method,
          status: response.status,
          statusText: response.statusText,
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
