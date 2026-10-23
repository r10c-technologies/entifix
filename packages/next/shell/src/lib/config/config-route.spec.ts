import { afterEach, describe, expect, it, vi } from 'vitest';

import { createConfigRoute, rewriteServiceDomains } from './config-route.js';

const CONFIG_URL = 'http://config.test';

let token = 'a-fleet-secret';
const source = (app: string) => () => ({
  url: `${CONFIG_URL}/api/config/${app}`,
  headers: { 'x-fleet-token': token },
});

const okConfig = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  token = 'a-fleet-secret';
});

describe('rewriteServiceDomains', () => {
  it('swaps a mapped domain for its proxy path', () => {
    const result = rewriteServiceDomains(
      {
        uri: [
          { key: 'admin-service-domain', value: 'http://localhost:3101/api' },
        ],
      },
      { 'admin-service-domain': '/api/admin' },
    );

    expect(result['uri']).toEqual([
      { key: 'admin-service-domain', value: '/api/admin' },
    ]);
  });

  it('rewrites several domains independently', () => {
    const result = rewriteServiceDomains(
      {
        uri: [
          { key: 'admin-service-domain', value: 'http://localhost:3101/api' },
          { key: 'config-service-domain', value: 'http://localhost:3190/api' },
        ],
      },
      {
        'admin-service-domain': '/api/admin',
        'config-service-domain': '/api/system',
      },
    );

    expect(result['uri']?.map(p => p.value)).toEqual([
      '/api/admin',
      '/api/system',
    ]);
  });

  it('passes through a key the app does not proxy', () => {
    const result = rewriteServiceDomains(
      { uri: [{ key: 'auth-service-domain', value: 'http://auth/api' }] },
      { 'config-service-domain': '/api/system' },
    );

    expect(result['uri']).toEqual([
      { key: 'auth-service-domain', value: 'http://auth/api' },
    ]);
  });

  it('keeps every other group untouched and tolerates a missing uri group', () => {
    const result = rewriteServiceDomains(
      { locale: [{ key: 'default', value: 'es' }] },
      { 'config-service-domain': '/api/system' },
    );

    expect(result['locale']).toEqual([{ key: 'default', value: 'es' }]);
    expect(result['uri']).toEqual([]);
  });
});

describe('createConfigRoute', () => {
  it('fetches this app configuration and rewrites the proxied domains', async () => {
    const fetchMock = vi.fn((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(
        okConfig({
          uri: [
            {
              key: 'config-service-domain',
              value: 'http://localhost:3190/api',
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await createConfigRoute({
      source: source('marketplace-admin-app'),
      proxies: { 'config-service-domain': '/api/system' },
    })();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      uri: [{ key: 'config-service-domain', value: '/api/system' }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${CONFIG_URL}/api/config/marketplace-admin-app`,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  // The source is read per request, so a rotated secret is sent at once.
  it('sends the headers its source names, read on each request', async () => {
    token = 'rotated';
    const fetchMock = vi.fn((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(okConfig({})),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createConfigRoute({ source: source('auth-app') })();

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { 'x-fleet-token': 'rotated' },
    });
  });

  it('rewrites nothing when the app declares no proxies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          okConfig({
            uri: [{ key: 'auth-service-domain', value: 'http://a' }],
          }),
        ),
      ),
    );

    const response = await createConfigRoute({ source: source('auth-app') })();

    expect(await response.json()).toEqual({
      uri: [{ key: 'auth-service-domain', value: 'http://a' }],
    });
  });

  it('502s when config-service is unreachable or answers an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('nope', { status: 500 }))),
    );

    const response = await createConfigRoute({ source: source('auth-app') })();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'Failed to load configuration',
    });
  });
});
