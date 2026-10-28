import {
  currentRemainingMs,
  DEADLINE_HEADER,
  DuplicateKey,
  Failure,
  InvalidQuery,
  Overloaded,
  PROBLEM_CONTENT_TYPE,
  Unavailable,
} from '@entifix/core';
import { Effect, Layer, Schema } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  defaultFailurePolicy,
  extendFailurePolicy,
  logLevelFor,
  mountRoutes,
  problemResponse,
  respond,
  statusFor,
} from './respond.js';
import {
  type RunningTestService,
  serveTestService,
} from './serve-test-service.js';

class TeapotRefusal extends Failure.declined<TeapotRefusal>()(
  'TeapotRefusal',
  'specTeapotRefusal',
  { pot: Schema.String },
) {}

const policy = extendFailurePolicy(defaultFailurePolicy, {
  tagStatus: { TeapotRefusal: 418 },
  tagLogLevel: { TeapotRefusal: 'Warn' },
});

describe('the failure policy', () => {
  it('answers a category with its default status and level', () => {
    const failure = new DuplicateKey({});

    expect(statusFor(failure, defaultFailurePolicy)).toBe(409);
    expect(logLevelFor(failure, defaultFailurePolicy)).toBe('Debug');
    expect(logLevelFor(new Unavailable({}), defaultFailurePolicy)).toBe('Warn');
  });

  it('lets a tag override its category', () => {
    const failure = new TeapotRefusal({ pot: 'blue' });

    expect(statusFor(failure, policy)).toBe(418);
    expect(logLevelFor(failure, policy)).toBe('Warn');
  });

  it('extends a base without dropping what it does not name', () => {
    const extended = extendFailurePolicy(defaultFailurePolicy, {
      categoryStatus: { declined: 409 },
      categoryLogLevel: { declined: 'Info' },
    });

    expect(extended.categoryStatus.declined).toBe(409);
    expect(extended.categoryStatus.invalid).toBe(400);
    expect(extended.categoryLogLevel.declined).toBe('Info');
  });
});

describe('problemResponse', () => {
  it('answers with the problem content type and the policy status', async () => {
    const response = HttpServerResponse.toWeb(
      problemResponse(new TeapotRefusal({ pot: 'blue' }), policy, {
        traceId: 'trace-1',
        instance: '/api/pot',
      }),
    );

    expect(response.status).toBe(418);
    expect(response.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
    expect(await response.json()).toEqual({
      type: 'urn:entifix:failure:specTeapotRefusal',
      title: 'TeapotRefusal',
      status: 418,
      code: 'specTeapotRefusal',
      category: 'declined',
      traceId: 'trace-1',
      instance: '/api/pot',
      pot: 'blue',
    });
  });

  it('carries Retry-After when the failure says when to come back', () => {
    const response = HttpServerResponse.toWeb(
      problemResponse(new Overloaded({ retryAfterSeconds: 7 })),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('7');
  });
});

describe('respond and mountRoutes, served', () => {
  let running: RunningTestService | undefined;

  const routes = mountRoutes(
    [
      HttpRouter.route(
        'GET',
        '/refused',
        Effect.fail(new TeapotRefusal({ pot: 'blue' })),
      ),
      HttpRouter.route(
        'GET',
        '/query',
        Effect.fail(new InvalidQuery({ reason: 'bad sort' })),
      ),
      HttpRouter.route(
        'GET',
        '/defect',
        Effect.die(new Error('the database password is hunter2')),
      ),
      HttpRouter.route(
        'GET',
        '/encoding',
        HttpServerResponse.json({ n: BigInt(1) }),
      ),
      HttpRouter.route('GET', '/ok', HttpServerResponse.text('fine')),
      HttpRouter.route(
        'GET',
        '/deadline',
        Effect.map(currentRemainingMs, left =>
          HttpServerResponse.text(left === undefined ? 'none' : String(left)),
        ),
      ),
    ],
    policy,
  );

  // Not mounted through `mountRoutes`: only the router's last net stands
  // between this defect and the client.
  const stray = HttpRouter.add(
    'GET',
    '/stray',
    Effect.die(new Error('nobody mounted me')),
  );

  beforeAll(async () => {
    running = await serveTestService({
      name: 'respond-spec',
      port: 0,
      slices: ['test'],
      router: Layer.mergeAll(routes, stray),
      // Nothing to compose: the routes need no services.
      appLayer: Layer.empty as never,
    });
  });

  afterAll(async () => {
    await running?.close();
  });

  const call = (path: string) => fetch(`${running?.baseUrl}${path}`);

  it('answers a failure as its problem body, with the policy status', async () => {
    const res = await call('/refused');

    expect(res.status).toBe(418);
    expect(res.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
    expect(await res.json()).toMatchObject({
      code: 'specTeapotRefusal',
      status: 418,
      instance: '/refused',
      pot: 'blue',
    });
  });

  it('carries a failure message as the detail', async () => {
    expect(await (await call('/query')).json()).toMatchObject({
      code: 'invalidQuery',
      detail: 'bad sort',
    });
  });

  it('answers a defect with an opaque 500 that leaks nothing', async () => {
    const res = await call('/defect');
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toMatchObject({ code: 'internal', status: 500 });
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('[object');
    expect(text).not.toMatch(/\n\s+at /);
  });

  it('answers a body that fails to encode as the same opaque 500', async () => {
    const res = await call('/encoding');

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'internal' });
  });

  it('hands the caller’s deadline to the handler', async () => {
    const withHeader = await fetch(`${running?.baseUrl}/deadline`, {
      headers: { [DEADLINE_HEADER]: '5000' },
    });
    const left = Number(await withHeader.text());

    expect(left).toBeGreaterThan(4_000);
    expect(left).toBeLessThanOrEqual(5_000);
    expect(await (await call('/deadline')).text()).toBe('none');
  });

  it('leaves a success alone', async () => {
    expect(await (await call('/ok')).text()).toBe('fine');
  });

  it('nets a defect from a route nobody mounted', async () => {
    const res = await call('/stray');

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'internal' });
  });

  it('refuses at compile time a handler failing with a plain Error', () => {
    // @ts-expect-error — an uncategorised failure cannot be answered honestly.
    mountRoutes([HttpRouter.route('GET', '/x', Effect.fail(new Error('no')))]);
  });

  it('names the trace a defect was logged under', async () => {
    const response = await Effect.runPromise(
      respond(Effect.die(new Error('boom'))).pipe(Effect.withSpan('spec')),
    );
    const body = (await HttpServerResponse.toWeb(response).json()) as {
      traceId?: unknown;
    };

    expect(body).toMatchObject({ code: 'internal' });
    expect(typeof body.traceId).toBe('string');
  });

  it('names no trace when none is open', async () => {
    const response = await Effect.runPromise(
      respond(Effect.die(new Error('boom'))),
    );

    expect(await HttpServerResponse.toWeb(response).json()).not.toHaveProperty(
      'traceId',
    );
  });

  it('answers through respond outside a route as well', async () => {
    const response = await Effect.runPromise(
      respond(Effect.fail(new DuplicateKey({ key: 'slug' }))),
    );

    expect(HttpServerResponse.toWeb(response).status).toBe(409);
  });
});
