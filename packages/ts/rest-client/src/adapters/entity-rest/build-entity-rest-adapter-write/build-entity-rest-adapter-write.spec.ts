import { accessor, type Entity, entity, type EntityId } from '@entifix/core';
import { makeStubUriConfigurationClient } from '@entifix/testing-unit';
import {
  http,
  HttpResponse,
  setupEntifixServer,
} from '@entifix/testing-unit/http';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { BuildEntityRestOptions } from '../types.js';
import { buildEntityRestAdapterWrite } from './build-entity-rest-adapter-write.js';

@entity({ key: 'gadget' })
class Gadget implements Entity {
  #id?: EntityId;
  #name?: string;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor()
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }
}

const BASE_URL = 'http://service/api/gadget';

const options: BuildEntityRestOptions = {
  uriConfig: { key: 'service-domain.[entity]', group: 'uri' },
  configuration: makeStubUriConfigurationClient(
    { gadget: BASE_URL },
    { keyTemplate: 'service-domain.[entity]', group: 'uri' },
  ),
};

const server = setupEntifixServer();

const gadget = (id: EntityId, name = 'Gizmo') => {
  const value = new Gadget();
  value.id = id;
  value.name = name;
  return value;
};

const links = [
  { rel: 'status', href: '/api/flow/f-1' },
  { rel: 'stream', href: '/api/push?topic=flow:f-1' },
];

const flowAccepted = () =>
  HttpResponse.json(
    { meta: { type: 'flowAccepted' }, data: { flowId: 'f-1', links } },
    { status: 202 },
  );

const entityBody = (id: string, name: string) =>
  HttpResponse.json(
    { meta: { type: 'entity', entity: 'gadget' }, data: { id, name } },
    { status: 201 },
  );

const write = (overrides: Partial<BuildEntityRestOptions> = {}) =>
  buildEntityRestAdapterWrite(Gadget, { ...options, ...overrides });

describe('buildEntityRestAdapterWrite', () => {
  it('settles a create with the entity the service stored', async () => {
    server.use(http.post(BASE_URL, () => entityBody('g-1', 'Stored')));

    const result = await Effect.runPromise(write().save(gadget(undefined)));

    expect(result._tag).toBe('settled');
    expect(result._tag === 'settled' && result.value.id).toBe('g-1');
    expect(result._tag === 'settled' && result.value.name).toBe('Stored');
  });

  it('answers a write handed to a flow as pending, with its links', async () => {
    server.use(http.post(BASE_URL, flowAccepted));

    expect(await Effect.runPromise(write().save(gadget(undefined)))).toEqual({
      _tag: 'pending',
      flowId: 'f-1',
      links,
    });
  });

  it('sends an update with the configured method', async () => {
    const methods: string[] = [];
    server.use(
      http.all(`${BASE_URL}/:id`, ({ request }) => {
        methods.push(request.method);
        return entityBody('g-1', 'Updated');
      }),
    );

    await Effect.runPromise(write().save(gadget('g-1')));
    await Effect.runPromise(write({ update: 'PATCH' }).save(gadget('g-1')));

    expect(methods).toEqual(['PUT', 'PATCH']);
  });

  it('refuses a 202 that does not describe a flow', async () => {
    server.use(
      http.post(BASE_URL, () =>
        HttpResponse.json(
          { meta: { type: 'entity' }, data: {} },
          { status: 202 },
        ),
      ),
    );

    const failure = await Effect.runPromise(
      Effect.flip(write().save(gadget(undefined))),
    );

    expect(failure).toMatchObject({ _tag: 'ProtocolFailure' });
  });

  it('settles a delete with nothing, by id or by entity', async () => {
    const deleted: string[] = [];
    server.use(
      http.delete(`${BASE_URL}/:id`, ({ params }) => {
        deleted.push(String(params['id']));
        return HttpResponse.json({ meta: { type: 'entity' }, data: {} });
      }),
    );

    expect(await Effect.runPromise(write().delete('g-1'))).toEqual({
      _tag: 'settled',
      value: undefined,
    });
    await Effect.runPromise(write().delete(gadget('g-2')));

    expect(deleted).toEqual(['g-1', 'g-2']);
  });

  it('answers a delete handed to a flow as pending', async () => {
    server.use(http.delete(`${BASE_URL}/:id`, flowAccepted));

    expect(await Effect.runPromise(write().delete('g-1'))).toMatchObject({
      _tag: 'pending',
      flowId: 'f-1',
    });
  });

  it('refuses to delete something with no id', async () => {
    const failure = await Effect.runPromise(
      Effect.flip(write().delete(gadget(undefined))),
    );

    expect(failure).toMatchObject({ _tag: 'Internal' });
  });
});
