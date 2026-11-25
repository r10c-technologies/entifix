import type { Entity } from '@entifix/core';
import { makeStubUriConfigurationClient } from '@entifix/testing-unit';
import {
  describeEntityRepositoryStateContract,
  type EntityRepositoryStateContractOptions,
  StatedWidget,
} from '@entifix/testing-unit/contracts';
import {
  entityRestHandlers,
  setupEntifixServer,
} from '@entifix/testing-unit/http';
import { Effect } from 'effect';

import { buildEntityRestAdapterGet } from './build-entity-rest-adapter-get/index.js';
import { buildEntityRestAdapterLoad } from './build-entity-rest-adapter-load/index.js';
import { buildEntityRestAdapterWrite } from './build-entity-rest-adapter-write/index.js';
import type { BuildEntityRestOptions } from './types.js';

const BASE_URL = 'http://service/api/stated-widget';

const options: BuildEntityRestOptions = {
  uriConfig: { key: 'service-domain.[entity]', group: 'uri' },
  configuration: makeStubUriConfigurationClient(
    { 'stated-widget': BASE_URL },
    { keyTemplate: 'service-domain.[entity]', group: 'uri' },
  ),
};

const server = setupEntifixServer();

/**
 * A repository over the REST adapters and the framework's own fake service, so
 * the state contract runs end to end through the wire format: the service
 * decides from the entity's own `writableWhen` and `deletableWhen`, and the
 * `409` it answers has to decode back into `UnavailableInState`. The adapter
 * sends no condition — the client never decides what the service allows.
 */
type Repository = Awaited<
  ReturnType<EntityRepositoryStateContractOptions['makeRepository']>
>;

const makeRepository = (seed: StatedWidget[]): Repository => {
  server.use(
    ...entityRestHandlers(StatedWidget, {
      baseUrl: BASE_URL,
      data: [...seed],
    }),
  );
  const write = buildEntityRestAdapterWrite(StatedWidget, options);
  return {
    get: buildEntityRestAdapterGet(StatedWidget, options),
    load: buildEntityRestAdapterLoad(StatedWidget, options),
    save: (entity: Entity) =>
      Effect.map(write.save(entity), result => {
        if (result._tag !== 'settled') throw new Error('expected a settle');
        return result.value;
      }),
    delete: (entityOrId: Entity | string) =>
      Effect.map(write.delete(entityOrId), () => undefined),
  } as unknown as Repository;
};

describeEntityRepositoryStateContract('REST adapter over the fake service', {
  makeRepository,
});
