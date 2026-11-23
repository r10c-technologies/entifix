import { defineEndpoint, implement } from '@entifix/core';
import { Effect, Layer, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { SharedToken } from '../auth/shared-token.js';
import { defaultFailurePolicy } from '../respond.js';
import type { RunningTestService } from '../serve-test-service.js';
import { serveTestService } from '../serve-test-service.js';
import { endpointGroup, endpointsOf } from './build-api.js';
import { serviceApi, serviceOpenApi } from './service-api.js';
import { OPENAPI_PATH } from './service-group.js';

const NAME = 'documented-service';
const SLICES = ['catalog'];
const GUARD: SharedToken = { header: 'x-fleet-token', token: () => 'a-secret' };

const item = defineEndpoint({
  name: 'item',
  method: 'GET',
  path: '/api/item/:id',
  params: Schema.Struct({ id: Schema.String }),
  success: Schema.Struct({ id: Schema.String, name: Schema.String }),
  errors: [],
  guard: { kind: 'public' },
});

const lookup = defineEndpoint({
  name: 'lookup',
  method: 'GET',
  path: '/api/lookup',
  success: Schema.String,
  errors: [],
  guard: { kind: 'fleet' },
});

const endpoints = [
  endpointGroup(
    'items',
    implement(item, ({ params }) =>
      Effect.succeed({ id: params.id, name: 'one' }),
    ),
  ),
  endpointGroup(
    'lookups',
    implement(lookup, () => Effect.succeed('ok')),
  ),
] as const;

let running: RunningTestService | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe('serviceOpenApi', () => {
  it('is the document the service answers at $openapi', async () => {
    running = await serveTestService({
      name: NAME,
      port: 0,
      slices: SLICES,
      description: GUARD,
      endpoints,
      policy: defaultFailurePolicy,
      appLayer: Layer.empty,
    });
    const served = await (
      await fetch(`${running.baseUrl}${OPENAPI_PATH}`, {
        headers: { [GUARD.header]: GUARD.token() },
      })
    ).json();

    const built = serviceOpenApi({
      name: NAME,
      slices: SLICES,
      described: true,
      endpoints,
      policy: defaultFailurePolicy,
    });

    expect(JSON.parse(JSON.stringify(built))).toEqual(served);
    expect(Object.keys(built.paths)).toEqual(
      expect.arrayContaining(['/api/item/{id}', '/api/lookup', OPENAPI_PATH]),
    );
  });

  it('documents only the health endpoints of a service with none of its own', () => {
    const document = serviceOpenApi({
      name: NAME,
      slices: SLICES,
      described: false,
    });

    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining(['/api/health']),
    );
    expect(Object.keys(document.paths)).not.toContain(OPENAPI_PATH);
  });
});

describe('serviceApi', () => {
  it('puts the endpoints every service has before its own', () => {
    const { groups, options } = serviceApi({
      name: NAME,
      slices: SLICES,
      described: true,
      endpoints,
    });

    expect(groups.map(group => group.name)).toEqual([
      'service',
      'items',
      'lookups',
    ]);
    expect(endpointsOf(groups)).toContain('GET /api/lookup');
    expect(options).toEqual({});
  });

  it('refuses a fleet-guarded endpoint on a service that is not described', () => {
    expect(() =>
      serviceApi({ name: NAME, slices: SLICES, described: false, endpoints }),
    ).toThrow(
      "'documented-service' serves GET /api/lookup behind the fleet token and names no `description` to check it against",
    );
  });
});
