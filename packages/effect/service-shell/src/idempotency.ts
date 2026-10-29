import { createHash } from 'node:crypto';

import { IdempotencyStoreTag, type StoredResponse } from '@entifix/business';
import {
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyInFlight,
  IdempotencyKeyMissing,
  IdempotencyKeyReused,
  parseIdempotencyKey,
} from '@entifix/core';
import { Effect, Exit } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';

import { problemResponse } from './respond.js';

/** Set on a response replayed from the store, so a caller can tell. */
export const IDEMPOTENT_REPLAY_HEADER = 'idempotent-replayed';

/** Marks a handler as guarded, for {@link assertRetriedRoutesIdempotent}. */
const IDEMPOTENT = Symbol.for('@entifix/service-shell/idempotent');

/** Sorted keys at every depth, so two equal bodies hash equally whatever their key order. */
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map(key => [
              key,
              canonical((value as Record<string, unknown>)[key]),
            ]),
        )
      : value;

/**
 * The fingerprint of a request body: SHA-256 over its canonical JSON, or over
 * the raw text when it is not JSON. It is what tells a retry from a different
 * request that reused a key.
 */
export const requestFingerprint = (body: string): string => {
  let text = body;
  try {
    text = JSON.stringify(canonical(JSON.parse(body)));
  } catch {
    // Not JSON: the bytes are the request.
  }
  return createHash('sha256').update(text).digest('hex');
};

/** A response as it can be stored; `undefined` for a body that cannot be replayed. */
const storable = (
  response: HttpServerResponse.HttpServerResponse,
): StoredResponse | undefined => {
  const { body } = response;
  if (body._tag === 'Empty') return { status: response.status, body: '' };
  if (body._tag !== 'Uint8Array') return undefined;
  return {
    status: response.status,
    contentType: body.contentType,
    body: new TextDecoder().decode(body.body),
  };
};

export interface IdempotencyKeyOptions {
  /** The route's identity in the dedup key: `POST /api/payment`. */
  readonly route: string;
  /**
   * Who is calling: the principal's id on a session route, the crossing caller
   * on a participant route. Two callers choosing one key never collide.
   */
  readonly caller: string;
}

/**
 * Makes a write route idempotent on its `Idempotency-Key`
 * (draft-ietf-httpapi-idempotency-key-header), with the store the composition
 * root provides as {@link IdempotencyStoreTag}.
 *
 * - no key, or one that is not an RFC 9651 String → `400 idempotencyKeyMissing`;
 * - a key in use with another body → `422 idempotencyKeyReused`;
 * - a key whose first request has not finished → `409 idempotencyKeyInFlight`;
 * - a key whose first request finished → that response, replayed.
 *
 * An answer — any response below `500` — is remembered. A `5xx`, a failure or a
 * defect gives the key back, because none of them is an answer and the retry
 * the key exists for must be allowed to try again.
 */
export const requireIdempotencyKey =
  (options: IdempotencyKeyOptions) =>
  <E, R>(
    handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  ) => {
    const guarded = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const key = parseIdempotencyKey(request.headers[IDEMPOTENCY_KEY_HEADER]);
      if (key === undefined)
        return problemResponse(new IdempotencyKeyMissing());

      // The body is cached by the request, so the handler reads it again.
      // A body that cannot be read cannot be fingerprinted: that failure is the
      // transport's, and it travels as one.
      const body = yield* request.text;
      const fingerprint = requestFingerprint(body);
      const dedupKey = `${options.caller}|${options.route}|${key}`;
      const store = yield* IdempotencyStoreTag;

      const claim = yield* store.claim(dedupKey, fingerprint);
      if (claim._tag === 'existing') {
        const { record } = claim;
        if (record.fingerprint !== fingerprint)
          return problemResponse(new IdempotencyKeyReused());
        if (record.state === 'inFlight' || record.response === undefined)
          return problemResponse(new IdempotencyKeyInFlight());
        return HttpServerResponse.text(record.response.body, {
          status: record.response.status,
          ...(record.response.contentType === undefined
            ? {}
            : { contentType: record.response.contentType }),
          headers: { [IDEMPOTENT_REPLAY_HEADER]: 'true' },
        });
      }

      const exit = yield* Effect.exit(handler);
      if (Exit.isSuccess(exit)) {
        const stored = storable(exit.value);
        yield* stored === undefined || stored.status >= 500
          ? store.release(dedupKey)
          : store.complete(dedupKey, stored);
        return exit.value;
      }
      yield* store.release(dedupKey);
      return yield* exit;
    });
    return Object.assign(guarded, { [IDEMPOTENT]: true as const });
  };

/** Whether a handler was built through {@link requireIdempotencyKey}. */
export const isIdempotentHandler = (handler: unknown): boolean =>
  typeof handler === 'object' &&
  handler !== null &&
  (handler as Record<symbol, unknown>)[IDEMPOTENT] === true;

/** One route a service mounts, as the mount check sees it. */
export interface MountedRoute {
  readonly method: string;
  readonly path: string;
  readonly handler: unknown;
}

/**
 * Fails the build — throws at mount — when a route a flow Activity retries is
 * not guarded by {@link requireIdempotencyKey}. A retried write without a key
 * is a write that runs twice; finding that out from a duplicate capture is the
 * outcome this check exists to prevent.
 */
export const assertRetriedRoutesIdempotent = (
  routes: readonly MountedRoute[],
  retried: readonly { readonly method: string; readonly path: string }[],
): void => {
  const unguarded = retried.filter(target => {
    const route = routes.find(
      candidate =>
        candidate.method.toUpperCase() === target.method.toUpperCase() &&
        candidate.path === target.path,
    );
    return route === undefined || !isIdempotentHandler(route.handler);
  });
  if (unguarded.length > 0)
    throw new Error(
      'these routes are retried by a flow and are not idempotent on an Idempotency-Key: ' +
        unguarded.map(route => `${route.method} ${route.path}`).join(', '),
    );
};
