import { HealthRegistryTag, WiringRegistryTag } from '@entifix/business';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import { afterEach, describe, expect, it } from 'vitest';

import type { SharedToken } from './auth/shared-token.js';
import type { RunningTestService } from './serve-test-service.js';
import { serveTestService } from './serve-test-service.js';
import type { ServiceDescription } from './service-description-route.js';
import { SERVICE_DESCRIPTION_PATH } from './service-description-route.js';

const SERVICE_NAME = 'wiring-test-service';
const GUARD: SharedToken = { header: 'x-fleet-token', token: () => 'a-secret' };
const SLICES = ['marketplace-admin', 'transaction'];

let running: RunningTestService | undefined;

/**
 * A layer that registers exactly what a composition root would: a Mongo probe
 * covering two stores, a broker probe, an upstream, one binding and one publish.
 */
const wiringLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const health = yield* HealthRegistryTag;
    const wiring = yield* WiringRegistryTag;

    yield* health.register({
      name: 'mongo',
      kind: 'datastore',
      targets: ['catalog', 'saga'],
      check: Effect.succeed(true),
    });
    yield* health.register({
      name: 'amqp',
      kind: 'broker',
      targets: ['entifix.events'],
      check: Effect.succeed(true),
    });
    yield* health.register({
      name: 'zitadel',
      kind: 'upstream',
      targets: ['zitadel'],
      check: Effect.succeed(true),
    });

    yield* wiring.recordPublish('transaction.accepted');
    yield* wiring.recordSubscription({
      slice: 'transaction',
      pattern: 'transaction.*',
      mode: 'work',
      queue: 'transaction.transaction._star_',
    });
  }),
);

/**
 * Boots the real `makeServerLayer` wiring — the same path a `-service` takes,
 * minus the infrastructure — so the route under test is the mounted one.
 *
 * The router deliberately also carries a parametric `/api/:entity` sibling. The
 * description path is two static segments, so it must win; a parametric route
 * that matched first would answer its own `404` and the endpoint would read as
 * "this service has no description" while appearing mounted — the failure the
 * `$metadata` route had before it was registered first.
 */
// `null` rather than `undefined` for "no guard": passing `undefined` to a
// defaulted parameter triggers the default, which would mount the route.
const serve = async (
  description: SharedToken | null = GUARD,
): Promise<string> => {
  running = await serveTestService({
    name: SERVICE_NAME,
    description: description ?? undefined,
    port: 0,
    slices: SLICES,
    router: HttpRouter.addAll([
      HttpRouter.route(
        'GET',
        '/api/:entity',
        HttpServerResponse.json({ from: 'the parametric route' }),
      ),
    ]),
    appLayer: wiringLayer,
  });
  return running.baseUrl;
};

const describeService = async (
  baseUrl: string,
): Promise<ServiceDescription> => {
  const response = await fetch(`${baseUrl}${SERVICE_DESCRIPTION_PATH}`, {
    headers: { [GUARD.header]: GUARD.token() },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as ServiceDescription;
};

afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe('serviceDescriptionRoute', () => {
  // No guard means no route, never an open one: the document is a map of the
  // service's wiring.
  it('is not mounted when the service names no guard', async () => {
    const baseUrl = await serve(null);

    const response = await fetch(`${baseUrl}${SERVICE_DESCRIPTION_PATH}`, {
      headers: { [GUARD.header]: GUARD.token() },
    });

    // The parametric sibling answers instead — the description is simply
    // not there to win.
    expect(await response.json()).toEqual({ from: 'the parametric route' });
  });

  it('answers 401 without the service token', async () => {
    const baseUrl = await serve();

    const response = await fetch(`${baseUrl}${SERVICE_DESCRIPTION_PATH}`);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('answers 401 with the wrong service token', async () => {
    const baseUrl = await serve();

    const response = await fetch(`${baseUrl}${SERVICE_DESCRIPTION_PATH}`, {
      headers: { [GUARD.header]: 'not-the-token' },
    });

    expect(response.status).toBe(401);
  });

  it('names the service and every slice the process hosts', async () => {
    const description = await describeService(await serve());

    expect(description.service).toBe(SERVICE_NAME);
    expect(description.slices).toEqual(SLICES);
  });

  // Generated from the health probe registrations, sorted by `kind` — one
  // registration behind both readiness and this document.
  it('sorts the probe registrations into stores, brokers and upstreams', async () => {
    const description = await describeService(await serve());

    expect(description.stores).toEqual([
      { name: 'catalog', probe: 'mongo' },
      { name: 'saga', probe: 'mongo' },
    ]);
    expect(description.brokers).toEqual([
      { name: 'entifix.events', probe: 'amqp' },
    ]);
    expect(description.upstreams).toEqual([
      { name: 'zitadel', probe: 'zitadel' },
    ]);
  });

  it('reports what the bus published and bound', async () => {
    const description = await describeService(await serve());

    expect(description.published).toEqual(['transaction.accepted']);
    expect(description.subscriptions).toEqual([
      {
        slice: 'transaction',
        pattern: 'transaction.*',
        mode: 'work',
        queue: 'transaction.transaction._star_',
      },
    ]);
  });

  /**
   * The security property, asserted rather than reviewed: a tenant database is
   * named after an organization, so a wiring document that leaked one would be
   * an organization enumerator. Logical names only — no URI, no `tenant_` and
   * no credential.
   */
  it('carries no URI, database name or organization id', async () => {
    const body = JSON.stringify(await describeService(await serve()));

    expect(body).not.toMatch(/tenant_/);
    expect(body).not.toMatch(/:\/\//);
  });

  // Static beats parametric, and there is no backtracking once the parametric
  // branch matches — so registering the sibling is the whole point of the case.
  it('wins the route match against a parametric sibling', async () => {
    const baseUrl = await serve();

    const parametric = await fetch(`${baseUrl}/api/anything`);
    expect(await parametric.json()).toEqual({ from: 'the parametric route' });

    const description = await describeService(baseUrl);
    expect(description.service).toBe(SERVICE_NAME);
  });

  // Readiness is unauthenticated on purpose and must stay that way — a probe
  // cannot hold a credential.
  it('leaves the health endpoints open', async () => {
    const baseUrl = await serve();

    const ready = await fetch(`${baseUrl}/api/health/ready`);

    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({
      status: 'ready',
      service: SERVICE_NAME,
    });
  });
});
