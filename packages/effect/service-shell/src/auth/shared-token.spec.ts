import { Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import { afterEach, describe, expect, it } from 'vitest';

import { serveTestService } from '../serve-test-service.js';
import { requireSharedToken, type SharedToken } from './shared-token.js';

const HEADER = 'x-fleet-token';
const TOKEN = 'a-fleet-secret';

let current = TOKEN;
const shared: SharedToken = { header: HEADER, token: () => current };

const router = HttpRouter.addAll([
  HttpRouter.route(
    'GET',
    '/api/config/auth-service',
    requireSharedToken(shared)(HttpServerResponse.json({ mongo: [] })),
  ),
]);

const withService = async (
  use: (baseUrl: string) => Promise<void>,
): Promise<void> => {
  const service = await serveTestService({
    name: 'spec-config-service',
    port: 0,
    slices: ['test'],
    router,
    appLayer: Layer.empty,
  });
  try {
    await use(service.baseUrl);
  } finally {
    await service.close();
  }
};

afterEach(() => {
  current = TOKEN;
});

describe('requireSharedToken', () => {
  it('serves the route when the token matches', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/config/auth-service`, {
        headers: { [HEADER]: TOKEN },
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ mongo: [] });
    });
  });

  it('401s without the header', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/config/auth-service`);

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: 'unauthenticated',
        code: 'unauthenticated',
      });
    });
  });

  it('401s on a wrong token of the same length', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/config/auth-service`, {
        headers: {
          [HEADER]: 'x'.repeat(TOKEN.length),
        },
      });

      expect(res.status).toBe(401);
    });
  });

  it('401s on a token of a different length', async () => {
    // The length guard exists because `timingSafeEqual` throws on a mismatch;
    // it must answer 401 rather than 500.
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/config/auth-service`, {
        headers: { [HEADER]: 'short' },
      });

      expect(res.status).toBe(401);
    });
  });

  // The token is asked for per request, so a rotation takes effect at once.
  it('reads the expected token on each request', async () => {
    await withService(async baseUrl => {
      current = 'rotated-secret';
      const res = await fetch(`${baseUrl}/api/config/auth-service`, {
        headers: { [HEADER]: 'rotated-secret' },
      });

      expect(res.status).toBe(200);
    });
  });

  it('leaves the health endpoints unguarded', async () => {
    // The probes come from the service base, not this router — asserting on them
    // is what pins the guard to the routes that carry credentials and no others.
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/health/ready`);

      expect(res.status).toBe(200);
    });
  });
});
