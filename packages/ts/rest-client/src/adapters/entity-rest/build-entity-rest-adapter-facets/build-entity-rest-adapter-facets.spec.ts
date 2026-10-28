import { makeStubUriConfigurationClient, runExit } from '@entifix/testing-unit';
import {
  ContractWidget,
  describeEntityFacetCounterContract,
} from '@entifix/testing-unit/contracts';
import {
  entityRestHandlers,
  http,
  HttpResponse,
  setupEntifixServer,
} from '@entifix/testing-unit/http';
import { Cause, Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { BuildEntityRestOptions } from '../types.js';
import { buildEntityRestAdapterFacets } from './build-entity-rest-adapter-facets.js';

const BASE_URL = 'http://service/api/contract-widget';

const restOptions: BuildEntityRestOptions = {
  uriConfig: { key: 'service-domain.[entity]', group: 'uri' },
  configuration: makeStubUriConfigurationClient(
    { 'contract-widget': BASE_URL },
    { keyTemplate: 'service-domain.[entity]', group: 'uri' },
  ),
};

const server = setupEntifixServer();

const count = buildEntityRestAdapterFacets(ContractWidget, restOptions);

// Through the wire and back: the adapter's serializer, the service-side
// parser, the in-memory counter and the envelope reader, all for real.
describeEntityFacetCounterContract('rest adapter over msw', {
  makeCounter: seed => {
    server.use(
      ...entityRestHandlers(ContractWidget, { baseUrl: BASE_URL, data: seed }),
    );
    return { count };
  },
  countsCollections: false,
});

describe('buildEntityRestAdapterFacets', () => {
  it('GETs `$facets` with each member and its own filtering', async () => {
    const urls: string[] = [];
    server.use(
      http.get(`${BASE_URL}/$facets`, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({
          meta: { type: 'entityFacets', entity: 'contract-widget' },
          data: { name: [{ value: 'Alpha', count: 1 }] },
        });
      }),
    );

    const counts = await Effect.runPromise(
      count<ContractWidget>([
        {
          member: 'name',
          filtering: [{ property: 'size', operator: 'gte', value: 2 }],
        },
      ]),
    );

    expect(counts).toEqual({ name: [{ value: 'Alpha', count: 1 }] });
    expect(urls).toEqual([
      `${BASE_URL}/$facets?facet=name&rsql.name=size%3Dge%3D2`,
    ]);
  });

  it('asks nothing of the service when nothing is asked', async () => {
    expect(await Effect.runPromise(count([]))).toEqual({});
  });

  it('refuses a body that is not facet counts', async () => {
    server.use(
      http.get(`${BASE_URL}/$facets`, () =>
        HttpResponse.json({
          meta: { type: 'entityFacets', entity: 'contract-widget' },
          data: { name: [{ value: 'Alpha' }] },
        }),
      ),
    );

    const exit = await runExit(count<ContractWidget>([{ member: 'name' }]));

    expect(
      Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined,
    ).toMatchObject({ _tag: 'InvalidEnvelope', category: 'invalid' });
  });
});
