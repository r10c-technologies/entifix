import { accessor, type Entity, entity, type EntityId } from '@entifix/core';
import { makeStubUriConfigurationClient } from '@entifix/testing-unit';
import {
  entityRestHandlers,
  http,
  HttpResponse,
  respondWith500,
  respondWithMalformedEnvelope,
  setupEntifixServer,
} from '@entifix/testing-unit/http';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { BuildEntityRestOptions } from '../types.js';
import { buildEntityRestAdapterSave } from './build-entity-rest-adapter-save.js';

@entity({ key: 'widget' })
class Widget implements Entity {
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

const BASE_URL = 'http://service/api/widget';

const restOptions: BuildEntityRestOptions = {
  uriConfig: { key: 'service-domain.[entity]', group: 'uri' },
  configuration: makeStubUriConfigurationClient(
    { widget: BASE_URL },
    { keyTemplate: 'service-domain.[entity]', group: 'uri' },
  ),
};

// Every request goes through MSW, so what is asserted is the wire: the method,
// the URL, and the envelope — not that some function was handed an object.
const server = setupEntifixServer(
  ...entityRestHandlers(Widget, { baseUrl: BASE_URL }),
);

const makeWidget = (id: EntityId, name: string): Widget => {
  const widget = new Widget();
  widget.id = id;
  widget.name = name;
  return widget;
};

const recordRequests = () => {
  const requests: Array<{ method: string; url: string }> = [];
  server.events.on('request:start', ({ request }) => {
    requests.push({ method: request.method, url: request.url });
  });
  return requests;
};

const runSave = (widget: Widget) =>
  Effect.runPromise(buildEntityRestAdapterSave(Widget, restOptions)(widget));

/** The same adapter, opted into the transactional (CQRS) create path. */
describe('buildEntityRestAdapterSave', () => {
  it('POSTs to the collection when the entity has no id', async () => {
    const requests = recordRequests();

    await runSave(makeWidget(undefined, 'Sprocket'));

    expect(requests).toContainEqual({ method: 'POST', url: BASE_URL });
  });

  it('PUTs to the entity URL when the entity already has an id', async () => {
    const requests = recordRequests();

    await runSave(makeWidget('widget-1', 'Sprocket'));

    expect(requests).toContainEqual({
      method: 'PUT',
      url: `${BASE_URL}/widget-1`,
    });
  });

  it('PATCHes the entity URL when updates merge', async () => {
    const requests = recordRequests();
    server.use(
      http.patch(`${BASE_URL}/:id`, () =>
        HttpResponse.json({
          meta: { type: 'entity', entity: 'widget' },
          data: { id: 'widget-1', name: 'Merged' },
        }),
      ),
    );

    const saved = await Effect.runPromise(
      buildEntityRestAdapterSave(Widget, { ...restOptions, update: 'PATCH' })(
        makeWidget('widget-1', 'Sprocket'),
      ),
    );

    expect(requests).toContainEqual({
      method: 'PATCH',
      url: `${BASE_URL}/widget-1`,
    });
    expect(saved.name).toBe('Merged');
  });

  it('refuses a flow it has no way to return, and names the adapter that does', async () => {
    server.use(
      http.put(`${BASE_URL}/:id`, () =>
        HttpResponse.json(
          {
            meta: { type: 'flowAccepted' },
            data: { flowId: 'f-1', links: [] },
          },
          { status: 202 },
        ),
      ),
    );

    const failure = await Effect.runPromise(
      Effect.flip(
        buildEntityRestAdapterSave(
          Widget,
          restOptions,
        )(makeWidget('widget-1', 'Sprocket')),
      ),
    );

    expect(failure).toMatchObject({
      _tag: 'ProtocolFailure',
      reason: expect.stringContaining('buildEntityRestAdapterWrite'),
    });
  });

  it('sends the entity as an envelope body', async () => {
    let received: unknown;
    server.use(
      http.put(`${BASE_URL}/:id`, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({
          meta: { type: 'entity', entity: 'widget' },
          data: { id: 'widget-1', name: 'Sprocket' },
        });
      }),
    );

    await runSave(makeWidget('widget-1', 'Sprocket'));

    expect(received).toEqual({
      meta: { type: 'entity', entity: 'widget' },
      data: { id: 'widget-1', name: 'Sprocket' },
    });
  });

  it('returns the entity from the response, not the one sent', async () => {
    server.use(
      http.post(BASE_URL, () =>
        HttpResponse.json({
          meta: { type: 'entity', entity: 'widget' },
          data: { id: 'generated-1', name: 'Normalized' },
        }),
      ),
    );

    const result = await runSave(makeWidget(undefined, 'Sprocket'));

    // The service is the authority on the stored truth — it minted the id and
    // normalized the name — so that is what callers must render.
    expect(result).toBeInstanceOf(Widget);
    expect(result.id).toBe('generated-1');
    expect(result.name).toBe('Normalized');
  });

  it('fails when the response is not an envelope', async () => {
    server.use(respondWithMalformedEnvelope(`${BASE_URL}/:id`, 'put'));

    await expect(runSave(makeWidget('widget-1', 'Sprocket'))).rejects.toThrow(
      /is not an envelope/,
    );
  });

  it('fails when the service answers with an error status', async () => {
    server.use(respondWith500(`${BASE_URL}/:id`, 'put'));

    await expect(runSave(makeWidget('widget-1', 'Sprocket'))).rejects.toThrow();
  });
});

describe('the Idempotency-Key a save sends', () => {
  const keysOf = () => {
    const keys: string[] = [];
    server.events.on('request:start', ({ request }) => {
      keys.push(request.headers.get('idempotency-key') ?? '');
    });
    return keys;
  };

  it('is sent on every write as an RFC 9651 String', async () => {
    const keys = keysOf();

    await runSave(makeWidget('widget-1', 'Sprocket'));

    expect(keys[0]).toMatch(/^"[0-9a-f-]{36}"$/);
  });

  // The case the key exists for: the same save called again after a network
  // error reaches the service under the same key.
  it('is reused by a save retried after a network error, and forgotten after success', async () => {
    const keys = keysOf();
    const widget = makeWidget('widget-1', 'Sprocket');
    server.use(
      http.put(`${BASE_URL}/:id`, () => HttpResponse.error(), { once: true }),
    );

    await expect(runSave(widget)).rejects.toThrow();
    await runSave(widget);
    await runSave(widget);

    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });
});
