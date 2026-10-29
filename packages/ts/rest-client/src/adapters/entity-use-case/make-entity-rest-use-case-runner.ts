import {
  type BulkOutcome,
  type Entity,
  type EntityConstructor,
  type EntityUseCaseRunner,
  extractMetaEntity,
  toWireSelection,
} from '@entifix/core';
import { Effect } from 'effect';

import { performHttpRequestThroughFetch } from '../../clients/fetch/index.js';
import { buildEntityRestAdapterMixins as adapterMixins } from '../entity-rest/build-entity-rest-adapter-mixins/index.js';
import type { BuildEntityRestOptions } from '../entity-rest/types.js';

/**
 * Runs an entity's verbs against the service that serves them, at the path the
 * shell derives from each verb's key and binding — under the same base URL the
 * entity's other adapters use, so a same-origin proxy is followed the same way
 * ([ADR 0020](../../../../../../docs/adr/0020-endpoints-are-descriptors-and-the-shell-builds-an-httpapi.md)).
 *
 * A refusal arrives as the failure the service sent, decoded from its problem
 * body, so a screen shows the coded message rather than a generic error.
 */
export const makeEntityRestUseCaseRunner = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  { uriConfig, configuration }: BuildEntityRestOptions,
): EntityUseCaseRunner => {
  const metaEntity = extractMetaEntity(entityConstructor);
  const name = metaEntity.key ?? metaEntity.name;
  const baseUrl = (id?: string) =>
    adapterMixins.buildEntityBaseUrl(configuration, { uriConfig }, name, id);

  return {
    run: (useCase, id) =>
      Effect.gen(function* () {
        const url = yield* baseUrl(
          useCase.binding === 'entity' && id != null ? String(id) : undefined,
        );
        yield* performHttpRequestThroughFetch({
          method: 'POST',
          url: `${url}/${useCase.key}`,
        });
      }),
    bulk: (useCase, selection) =>
      Effect.gen(function* () {
        const url = yield* baseUrl();
        // The wire form, never the selection itself: a `Set` serializes to
        // `{}`, so a selection sent raw would lose its ids.
        const response = yield* performHttpRequestThroughFetch<
          readonly BulkOutcome[]
        >({
          method: 'POST',
          url: `${url}/${useCase.key}`,
          headers: { 'Content-Type': 'application/json' },
          body: { selection: toWireSelection(selection) },
        });
        return response.body;
      }),
  };
};
