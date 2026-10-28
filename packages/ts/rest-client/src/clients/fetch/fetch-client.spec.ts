import { DEADLINE_HEADER, DeadlineTag } from '@entifix/core';
import {
  http,
  HttpResponse,
  setupEntifixServer,
} from '@entifix/testing-unit/http';
import { Effect, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';

import { performHttpRequestThroughFetch } from './fetch-client.js';

const URL = 'http://service/api/thing';

const delay = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

const seen: Array<string | null> = [];
let aborted = false;

setupEntifixServer(
  http.get(URL, ({ request }) => {
    seen.push(request.headers.get(DEADLINE_HEADER));
    return HttpResponse.json({ ok: true });
  }),
  http.get(
    `${URL}/garbled`,
    () =>
      new HttpResponse('{ not json', {
        status: 500,
        headers: { 'content-type': 'application/problem+json' },
      }),
  ),
  http.get(`${URL}/slow`, async ({ request }) => {
    request.signal.addEventListener('abort', () => {
      aborted = true;
    });
    await delay(5_000);
    return HttpResponse.json({ ok: true });
  }),
);

const get = (url = URL) =>
  performHttpRequestThroughFetch({ method: 'GET', url, headers: {} });

describe('performHttpRequestThroughFetch and the deadline', () => {
  it('forwards no deadline when the caller named none', async () => {
    await Effect.runPromise(get());

    expect(seen.at(-1)).toBeNull();
  });

  it('forwards what is left of the caller’s budget', async () => {
    await Effect.runPromise(
      get().pipe(
        Effect.provideService(DeadlineTag, { expiresAt: Date.now() + 10_000 }),
      ),
    );

    const forwarded = Number(seen.at(-1));
    expect(forwarded).toBeGreaterThan(9_000);
    expect(forwarded).toBeLessThanOrEqual(10_000);
  });

  it('makes no call once the budget is spent', async () => {
    const before = seen.length;

    const failure = await Effect.runPromise(
      Effect.flip(
        get().pipe(
          Effect.provideService(DeadlineTag, { expiresAt: Date.now() - 1 }),
        ),
      ),
    );

    expect(failure).toMatchObject({ _tag: 'Timeout', category: 'timeout' });
    expect(seen.length).toBe(before);
  });

  it('aborts the request when its fiber is interrupted', async () => {
    const fiber = Effect.runFork(get(`${URL}/slow`));
    await delay(50);
    await Effect.runPromise(Fiber.interrupt(fiber));
    await delay(20);

    expect(aborted).toBe(true);
  });
});

describe('performHttpRequestThroughFetch and a failure it cannot read', () => {
  it('answers a problem-typed body that is not JSON as a protocol failure', async () => {
    const failure = await Effect.runPromise(Effect.flip(get(`${URL}/garbled`)));

    expect(failure).toMatchObject({
      _tag: 'ProtocolFailure',
      upstreamStatus: 500,
    });
  });

  it('names the address itself when it is not a URL at all', async () => {
    const failure = await Effect.runPromise(Effect.flip(get('not a url')));

    expect(failure).toMatchObject({
      _tag: 'Unavailable',
      dependency: 'not a url',
    });
  });
});
