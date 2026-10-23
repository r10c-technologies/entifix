import { ConfigurationClientInMemory, EntifixConnError } from '@entifix/core';
import {
  http,
  HttpResponse,
  setupEntifixServer,
} from '@entifix/testing-unit/http';
import { Context, Effect, Schedule } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  LoadedConfigurationTag,
  loadRemoteConfiguration,
  loadRemoteConfigurationClient,
} from './load-remote-configuration.js';

const CONFIG_API = 'http://config-service:3190';
const SERVICE = 'marketplace-admin-service';
const URL_ = `${CONFIG_API}/api/config/${SERVICE}`;
const SOURCE = { url: URL_, headers: { 'x-fleet-token': 'a-secret' } };

// Fail fast in the error-path tests: a single attempt, no boot-retry wait.
const noRetry = { retrySchedule: Schedule.recurs(0) } as const;
// Retry immediately (no delay) so the recovery test doesn't wait real seconds.
const instantRetry = { retrySchedule: Schedule.recurs(5) } as const;

const plain = {
  mongo: [
    { key: 'uri', value: 'mongodb://host/db' },
    { key: 'db', value: 'catalog' },
  ],
};

const server = setupEntifixServer(
  http.get(`${CONFIG_API}/api/config/${SERVICE}`, () =>
    HttpResponse.json(plain),
  ),
);

describe('loadRemoteConfiguration', () => {
  it('fetches the service’s own configuration document', async () => {
    expect(await Effect.runPromise(loadRemoteConfiguration(SOURCE))).toEqual(
      plain,
    );
  });

  // The URL and the credential are the host's protocol: the loader composes
  // neither, and sends exactly what it was given.
  it('fetches the URL it is given, with the headers it is given', async () => {
    const seen: { url: string; token: string | null }[] = [];
    server.events.on('request:start', ({ request }) => {
      seen.push({
        url: request.url,
        token: request.headers.get('x-fleet-token'),
      });
    });

    await Effect.runPromise(loadRemoteConfiguration(SOURCE));

    expect(seen).toContainEqual({ url: URL_, token: 'a-secret' });
  });

  it.each([
    ['an error status', () => new HttpResponse(null, { status: 500 })],
    ['a dropped connection', () => HttpResponse.error()],
    ['a non-JSON body', () => new HttpResponse('<html>nope</html>')],
  ])('fails with EntifixConnError on %s', async (_label, respond) => {
    server.use(http.get(`${CONFIG_API}/api/config/${SERVICE}`, respond));

    const error = await Effect.runPromise(
      Effect.flip(loadRemoteConfiguration(SOURCE, noRetry)),
    );

    expect(error).toBeInstanceOf(EntifixConnError);
    expect(error.message).toContain(URL_);
    expect(error.details).toMatchObject({ url: URL_ });
  });

  it('reports the status it got back', async () => {
    server.use(
      http.get(
        `${CONFIG_API}/api/config/${SERVICE}`,
        () => new HttpResponse(null, { status: 404 }),
      ),
    );

    const error = await Effect.runPromise(
      Effect.flip(loadRemoteConfiguration(SOURCE, noRetry)),
    );

    expect(error.cause?.message).toContain('404');
  });

  // A dependent can boot before config-service is HTTP-ready; the bounded
  // retry rides out the early connection failures instead of crashing.
  it('retries until config-service answers', async () => {
    let attempts = 0;
    server.use(
      http.get(`${CONFIG_API}/api/config/${SERVICE}`, () => {
        attempts += 1;
        if (attempts < 3) return HttpResponse.error();
        return HttpResponse.json(plain);
      }),
    );

    const result = await Effect.runPromise(
      loadRemoteConfiguration(SOURCE, instantRetry),
    );

    expect(attempts).toBe(3);
    expect(result).toEqual(plain);
  });

  // `fetch` has no timeout of its own, so a socket that is accepted and
  // never answered used to hang the boot forever — the retry above never saw a
  // failure to act on, and the service sat there with its port bound serving
  // nothing. The deadline is what turns that into an ordinary failure.
  it('gives up on a peer that accepts the connection and never answers', async () => {
    server.use(
      http.get(
        `${CONFIG_API}/api/config/${SERVICE}`,
        () => new Promise<never>(() => undefined),
      ),
    );

    const error = await Effect.runPromise(
      Effect.flip(
        loadRemoteConfiguration(SOURCE, {
          ...noRetry,
          attemptTimeoutMs: 25,
        }),
      ),
    );

    expect(error).toBeInstanceOf(EntifixConnError);
    expect(error.cause?.message).toContain('did not answer within 25ms');
  });

  // The half that actually fixes the reported bug: a hang has to be *retryable*,
  // not merely reported. A peer that hangs once and then answers must be ridden
  // out exactly like a connection refusal.
  it('retries past a hang and succeeds when the peer recovers', async () => {
    let attempts = 0;
    server.use(
      http.get(`${CONFIG_API}/api/config/${SERVICE}`, () => {
        attempts += 1;
        if (attempts === 1) return new Promise<never>(() => undefined);
        return HttpResponse.json(plain);
      }),
    );

    const result = await Effect.runPromise(
      loadRemoteConfiguration(SOURCE, {
        ...instantRetry,
        attemptTimeoutMs: 25,
      }),
    );

    expect(attempts).toBe(2);
    expect(result).toEqual(plain);
  });

  // The retry window is bounded — a config-service that never comes back still
  // surfaces the error rather than hanging forever.
  it('gives up with EntifixConnError once the retry budget is exhausted', async () => {
    server.use(
      http.get(`${CONFIG_API}/api/config/${SERVICE}`, () =>
        HttpResponse.error(),
      ),
    );

    const error = await Effect.runPromise(
      Effect.flip(loadRemoteConfiguration(SOURCE, instantRetry)),
    );

    expect(error).toBeInstanceOf(EntifixConnError);
  });
});

describe('loadRemoteConfigurationClient', () => {
  it('wraps the fetched configuration in a readable store', async () => {
    const store = await Effect.runPromise(
      loadRemoteConfigurationClient(SOURCE),
    );

    expect(store).toBeInstanceOf(ConfigurationClientInMemory);
    expect(await Effect.runPromise(store.in('mongo').getString('uri'))).toBe(
      'mongodb://host/db',
    );
  });

  it('propagates the load failure rather than yielding an empty store', async () => {
    server.use(
      http.get(
        `${CONFIG_API}/api/config/${SERVICE}`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );

    const error = await Effect.runPromise(
      Effect.flip(loadRemoteConfigurationClient(SOURCE, noRetry)),
    );

    expect(error).toBeInstanceOf(EntifixConnError);
  });
});

describe('LoadedConfigurationTag', () => {
  // The raw document is kept in context so `GET /api/config` can expose it
  // (redacted) without re-fetching.
  it('carries the loaded document through the Effect context', () => {
    const context = Context.make(LoadedConfigurationTag, plain);

    expect(Context.get(context, LoadedConfigurationTag)).toBe(plain);
  });
});
