import { IdempotencyStoreTag } from '@entifix/business';
import { formatIdempotencyKey, Unavailable } from '@entifix/core';
import { makeInMemoryIdempotencyStore } from '@entifix/testing-unit';
import { Effect } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';
import { describe, expect, it } from 'vitest';

import {
  assertRetriedRoutesIdempotent,
  IDEMPOTENT_REPLAY_HEADER,
  isIdempotentHandler,
  requestFingerprint,
  requireIdempotencyKey,
} from './idempotency.js';

const guard = requireIdempotencyKey({
  route: 'POST /api/payment',
  caller: 'fleet',
});

const call = (
  store: ReturnType<typeof makeInMemoryIdempotencyStore>,
  handler: Effect.Effect<HttpServerResponse.HttpServerResponse, unknown>,
  { key, body = '{"amount":10}' }: { key?: string; body?: string } = {},
) =>
  Effect.runPromise(
    Effect.exit(
      guard(handler).pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(
            new Request('http://test/api/payment', {
              method: 'POST',
              body,
              headers:
                key === undefined
                  ? {}
                  : { 'idempotency-key': formatIdempotencyKey(key) },
            }),
          ),
        ),
        Effect.provideService(IdempotencyStoreTag, store),
      ),
    ),
  );

const valueOf = async (
  exit: Awaited<ReturnType<typeof call>>,
): Promise<HttpServerResponse.HttpServerResponse> => {
  if (exit._tag !== 'Success') throw new Error('expected a response');
  return exit.value;
};

const problem = async (exit: Awaited<ReturnType<typeof call>>) => {
  const response = await valueOf(exit);
  const body = response.body;
  return {
    status: response.status,
    code:
      body._tag === 'Uint8Array'
        ? (JSON.parse(new TextDecoder().decode(body.body)) as { code: string })
            .code
        : undefined,
  };
};

const fresh = () => makeInMemoryIdempotencyStore({ retentionMs: 60_000 });

describe('requireIdempotencyKey', () => {
  it('answers 400 without a key, or with one that is not an sf-string', async () => {
    const store = fresh();
    expect(
      await problem(
        await call(store, Effect.succeed(HttpServerResponse.empty())),
      ),
    ).toEqual({
      status: 400,
      code: 'idempotencyKeyMissing',
    });
  });

  it('runs the handler once and replays its answer for a duplicate', async () => {
    const store = fresh();
    let runs = 0;
    const handler = Effect.sync(() => {
      runs += 1;
      return HttpServerResponse.text('{"captured":true}', {
        status: 201,
        contentType: 'application/json',
      });
    });

    const first = await valueOf(await call(store, handler, { key: 'k-1' }));
    const again = await valueOf(await call(store, handler, { key: 'k-1' }));

    expect(runs).toBe(1);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.headers[IDEMPOTENT_REPLAY_HEADER]).toBe('true');
  });

  it('replays a body-less answer', async () => {
    const store = fresh();
    await call(
      store,
      Effect.succeed(HttpServerResponse.empty({ status: 204 })),
      {
        key: 'k',
      },
    );

    expect(
      (await valueOf(await call(store, Effect.die('never'), { key: 'k' })))
        .status,
    ).toBe(204);
  });

  it('answers 422 for the same key with another body', async () => {
    const store = fresh();
    await call(store, Effect.succeed(HttpServerResponse.empty()), { key: 'k' });

    expect(
      await problem(
        await call(store, Effect.succeed(HttpServerResponse.empty()), {
          key: 'k',
          body: '{"amount":11}',
        }),
      ),
    ).toEqual({ status: 422, code: 'idempotencyKeyReused' });
  });

  // Key order is not a different request.
  it('treats the same JSON in another key order as the same request', () => {
    const target = 'POST /api/payment';
    expect(
      requestFingerprint(target, '{"a":1,"b":{"c":2,"d":[1,{"f":1,"e":2}]}}'),
    ).toBe(
      requestFingerprint(target, '{"b":{"d":[1,{"e":2,"f":1}],"c":2},"a":1}'),
    );
    expect(requestFingerprint(target, 'not json')).not.toBe(
      requestFingerprint(target, 'not json!'),
    );
  });

  // One key on two records of one route is two requests, not a retry.
  it('tells two concrete targets apart under one body', () => {
    expect(requestFingerprint('POST /api/order/o1', '{}')).not.toBe(
      requestFingerprint('POST /api/order/o2', '{}'),
    );
  });

  it('answers 409 while the first request is in flight', async () => {
    const store = fresh();
    await Effect.runPromise(
      store.claim(
        'fleet|POST /api/payment|k',
        requestFingerprint('POST /api/payment', '{"amount":10}'),
      ),
    );

    expect(
      await problem(await call(store, Effect.die('never'), { key: 'k' })),
    ).toEqual({ status: 409, code: 'idempotencyKeyInFlight' });
  });

  it('gives the key back after a failure, so a retry runs', async () => {
    const store = fresh();
    await call(store, Effect.fail(new Unavailable({ dependency: 'x' })), {
      key: 'k',
    });

    const retried = await call(
      store,
      Effect.succeed(HttpServerResponse.empty()),
      {
        key: 'k',
      },
    );
    expect((await valueOf(retried)).status).toBe(204);
  });

  it('gives the key back after a 5xx or a body it cannot store', async () => {
    const store = fresh();
    await call(
      store,
      Effect.succeed(HttpServerResponse.empty({ status: 503 })),
      {
        key: 'a',
      },
    );
    await call(
      store,
      Effect.succeed(
        HttpServerResponse.raw('stream', { contentType: 'text/plain' }),
      ),
      { key: 'b' },
    );

    expect(store.records.size).toBe(0);
  });

  it('reads a request with no body', async () => {
    const store = fresh();
    const exit = await call(store, Effect.succeed(HttpServerResponse.empty()), {
      key: 'k',
      body: '',
    });

    expect((await valueOf(exit)).status).toBe(204);
  });
});

describe('assertRetriedRoutesIdempotent', () => {
  const guarded = guard(Effect.succeed(HttpServerResponse.empty()));
  const plain = Effect.succeed(HttpServerResponse.empty());

  it('recognises a guarded handler', () => {
    expect(isIdempotentHandler(guarded)).toBe(true);
    expect(isIdempotentHandler(plain)).toBe(false);
    expect(isIdempotentHandler(null)).toBe(false);
  });

  it('passes when every retried route is guarded', () => {
    expect(() =>
      assertRetriedRoutesIdempotent(
        [{ method: 'POST', path: '/api/payment', handler: guarded }],
        [{ method: 'post', path: '/api/payment' }],
      ),
    ).not.toThrow();
  });

  it('fails the mount for a planted retried route without the guard', () => {
    expect(() =>
      assertRetriedRoutesIdempotent(
        [
          { method: 'POST', path: '/api/payment', handler: guarded },
          { method: 'POST', path: '/api/refund', handler: plain },
        ],
        [
          { method: 'POST', path: '/api/refund' },
          { method: 'DELETE', path: '/api/reservation/:id' },
        ],
      ),
    ).toThrow('POST /api/refund, DELETE /api/reservation/:id');
  });
});
