import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHealthRoutes } from './health-routes.js';

const CONFIG_URL = 'http://config.test/api/config/some-app';

let token = 'a-fleet-secret';
const OPTIONS = {
  app: 'some-app',
  configuration: () => ({
    url: CONFIG_URL,
    headers: { 'x-fleet-token': token },
  }),
};

const stubFetch = (impl: typeof fetch) => {
  vi.stubGlobal('fetch', vi.fn(impl));
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  token = 'a-fleet-secret';
});

describe('createHealthRoutes', () => {
  it('keeps /api/health answering as it always did', async () => {
    const routes = createHealthRoutes(OPTIONS);

    const response = routes.health();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', app: OPTIONS.app });
  });

  // Liveness answers from the process alone — no config-service, no backend.
  // It is what Playwright's `webServer.url` waits on, so it must not depend on
  // anything that may not be running yet.
  it('answers liveness without touching config-service', async () => {
    const fetchMock = stubFetch(() => Promise.reject(new Error('unused')));
    const routes = createHealthRoutes(OPTIONS);

    const response = routes.live();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'live',
      app: OPTIONS.app,
      mode: 'development',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The field an e2e run reads to find out *which artifact* it attached to.
  // Playwright reuses whatever is already on the port, so without this a suite
  // can test a dev bundle while reporting on a production one.
  it('names the build answering the probe', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = createHealthRoutes(OPTIONS).live();

    expect(await response.json()).toMatchObject({ mode: 'production' });
  });

  // `/api/health` predates the probes and other things read it; it stays as it
  // was rather than growing a field alongside liveness.
  it('leaves the original health endpoint untouched', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = createHealthRoutes(OPTIONS).health();

    expect(await response.json()).toEqual({ status: 'ok', app: OPTIONS.app });
  });

  it('reports ready when config-service answers', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
    const routes = createHealthRoutes(OPTIONS);

    const response = await routes.ready();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ready',
      app: OPTIONS.app,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      CONFIG_URL,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  // A gated lookup answers `401` to a probe that omits the header, which reads
  // as "degraded" — an app that never becomes Ready while being perfectly
  // healthy. Regression guard for exactly that.
  it('sends the headers its configuration source names', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );

    await createHealthRoutes(OPTIONS).ready();

    expect(fetchMock).toHaveBeenCalledWith(
      CONFIG_URL,
      expect.objectContaining({
        headers: { 'x-fleet-token': 'a-fleet-secret' },
      }),
    );
  });

  it('reads the source on each probe, so a rotated secret is sent', async () => {
    token = 'rotated';
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );

    await createHealthRoutes(OPTIONS).ready();

    expect(fetchMock).toHaveBeenCalledWith(
      CONFIG_URL,
      expect.objectContaining({
        headers: { 'x-fleet-token': 'rotated' },
      }),
    );
  });

  it('reports degraded when config-service answers with an error', async () => {
    stubFetch(() => Promise.resolve(new Response('nope', { status: 500 })));
    const routes = createHealthRoutes(OPTIONS);

    const response = await routes.ready();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: 'degraded',
      app: OPTIONS.app,
      failing: ['config'],
    });
  });

  it('reports degraded when config-service is unreachable', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    const routes = createHealthRoutes(OPTIONS);

    const response = await routes.ready();

    expect(response.status).toBe(503);
  });

  it('serves a repeat readiness request from the cache', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
    const routes = createHealthRoutes(OPTIONS);

    await routes.ready();
    await routes.ready();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
