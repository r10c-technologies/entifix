import type { Entity } from '@entifix/core';
import { makeStubUriConfigurationClient } from '@entifix/testing-unit';
import {
  describeEntityRepositoryRevisionContract,
  type EntityRepositoryRevisionContractOptions,
  RevisedWidget,
} from '@entifix/testing-unit/contracts';
import {
  entityRestHandlers,
  setupEntifixServer,
} from '@entifix/testing-unit/http';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildEntityRestAdapterGet } from './build-entity-rest-adapter-get/index.js';
import { buildEntityRestAdapterLoad } from './build-entity-rest-adapter-load/index.js';
import { buildEntityRestAdapterWrite } from './build-entity-rest-adapter-write/index.js';
import type { BuildEntityRestOptions } from './types.js';

const BASE_URL = 'http://service/api/revised-widget';

const options: BuildEntityRestOptions = {
  uriConfig: { key: 'service-domain.[entity]', group: 'uri' },
  configuration: makeStubUriConfigurationClient(
    { 'revised-widget': BASE_URL },
    { keyTemplate: 'service-domain.[entity]', group: 'uri' },
  ),
};

const server = setupEntifixServer();

/**
 * A repository over the REST adapters and the framework's own fake service, so
 * the revision contract runs end to end through the wire format: the `409` a
 * stale save answers has to decode back into `StaleRevision`.
 */
type Repository = Awaited<
  ReturnType<EntityRepositoryRevisionContractOptions['makeRepository']>
>;

const makeRepository = (seed: RevisedWidget[]): Repository => {
  server.use(
    ...entityRestHandlers(RevisedWidget, {
      baseUrl: BASE_URL,
      data: [...seed],
    }),
  );
  const write = buildEntityRestAdapterWrite(RevisedWidget, options);
  return {
    get: buildEntityRestAdapterGet(RevisedWidget, options),
    load: buildEntityRestAdapterLoad(RevisedWidget, options),
    save: (entity: Entity) =>
      Effect.map(write.save(entity), result => {
        if (result._tag !== 'settled') throw new Error('expected a settle');
        return result.value;
      }),
    delete: (entityOrId: Entity | string) =>
      Effect.map(write.delete(entityOrId), () => undefined),
  } as unknown as Repository;
};

describeEntityRepositoryRevisionContract('REST adapter over the fake service', {
  makeRepository,
});

describe('buildEntityRestAdapterWrite for an entity that declares a revision', () => {
  const methods = (): string[] => {
    const seen: string[] = [];
    server.events.on('request:start', ({ request }) => {
      seen.push(`${request.method} ${new URL(request.url).pathname}`);
    });
    return seen;
  };

  it('sends a client-minted id with POST, since a create is the absence of a revision', async () => {
    const seen = methods();
    const repository = makeRepository([]);
    const widget = new RevisedWidget();
    widget.id = 'r-1';
    widget.name = 'Mine';

    await Effect.runPromise(repository.save<RevisedWidget>(widget));

    expect(seen).toEqual(['POST /api/revised-widget']);
  });

  it('sends an update to the record, with the revision it read', async () => {
    const seed = new RevisedWidget();
    seed.id = 'r-1';
    seed.name = 'Alpha';
    seed.revision = 1;
    const seen = methods();
    const repository = makeRepository([seed]);
    const widget = new RevisedWidget();
    widget.id = 'r-1';
    widget.name = 'Beta';
    widget.revision = 1;

    await Effect.runPromise(repository.save<RevisedWidget>(widget));

    expect(seen).toEqual(['PUT /api/revised-widget/r-1']);
    expect(widget.revision).toBe(1);
  });
});
