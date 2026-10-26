import {
  type Entity,
  type EntityConstructor,
  type EntityFacetCounts,
  type EntityFacetQuery,
  envelopeEntityName,
  readEntityFacetsEnvelope,
  serializeFacetQueryParams,
} from '@entifix/core';
import { Effect } from 'effect';

import { performHttpRequestThroughFetch } from '../../../clients/fetch/index.js';
import { buildEntityRestAdapterMixins as adapterMixins } from '../build-entity-rest-adapter-mixins/index.js';
import { BuildEntityRestOptions } from '../types.js';

/**
 * The `count` of an `EntityFacetCounter`, over a service's
 * `GET <entity>/$facets` — the load adapter's sibling, on the same base URL and
 * the same query protocol, so what this composes is what the service parses
 * back. The caller binds it to the port, as it binds `load` to the repository.
 */
export const buildEntityRestAdapterFacets =
  <TEntity extends Entity>(
    entityConstructor: EntityConstructor<TEntity>,
    { uriConfig, configuration }: BuildEntityRestOptions,
  ) =>
  <T extends Entity>(queries: readonly EntityFacetQuery<T>[]) =>
    Effect.gen(function* () {
      // Asking for nothing is answered without a round trip; the service
      // would refuse an empty request.
      if (queries.length === 0) return {} as EntityFacetCounts;

      const baseUrl = yield* adapterMixins.buildEntityBaseUrl(
        configuration,
        { uriConfig },
        envelopeEntityName(entityConstructor),
      );

      const query = serializeFacetQueryParams(queries).toString();
      const response = yield* performHttpRequestThroughFetch(
        adapterMixins.buildEntityRequest({
          method: 'GET',
          url: `${baseUrl}/$facets?${query}`,
        }),
      );
      return yield* readEntityFacetsEnvelope(entityConstructor, response.body);
    });
