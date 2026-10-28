import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { DuplicateKey, PROBLEM_CONTENT_TYPE } from '@entifix/core';
import { accessor, type Entity, entity, type EntityId } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import {
  entityRestHandlers,
  respondWith404,
  respondWith500,
  respondWithEntity,
  respondWithMalformedEnvelope,
  respondWithNetworkError,
  respondWithNonJson,
  respondWithProblem,
} from './entity-handlers.js';
import { setupEntifixServer } from './server.js';

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

const makeWidget = (id: EntityId, name: string) => {
  const widget = new Widget();
  widget.id = id;
  widget.name = name;
  return widget;
};

let rows: Widget[] = [];

const server = setupEntifixServer();

const useHandlers = (data: Widget[] = []) => {
  rows = data;
  server.use(...entityRestHandlers(Widget, { baseUrl: BASE_URL, data: rows }));
};

const getJson = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.json() };
};

describe('setupEntifixServer', () => {
  // A request nobody stubbed must fail the test rather than quietly escaping to
  // the network — a test that passes because it silently talked to nothing is
  // worse than one that fails.
  it('rejects an unhandled request', async () => {
    await expect(fetch('http://service/api/unstubbed')).rejects.toThrow();
  });

  // The host above does not resolve, so it would reject with or without msw.
  // A real server that answers 200 proves the strategy itself: the request is
  // refused before it can reach the network. msw 3 renamed the option to
  // `onUnhandledFrame`, and the old name is ignored rather than rejected.
  it('refuses an unhandled request even when something would answer it', async () => {
    const listening = createServer((_request, response) =>
      response.end('reached the network'),
    );
    await new Promise<void>(resolve =>
      listening.listen(0, '127.0.0.1', resolve),
    );
    const { port } = listening.address() as AddressInfo;
    try {
      await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    } finally {
      listening.close();
    }
  });

  it('serves the handlers it was given', async () => {
    useHandlers([makeWidget('w-1', 'Alpha')]);

    const { body } = await getJson(BASE_URL);

    expect(body).toMatchObject({
      meta: { type: 'entityPage', entity: 'widget' },
    });
  });
});

describe('entityRestHandlers $facets', () => {
  it('counts the rows through the real protocol, ahead of `/:id`', async () => {
    useHandlers([makeWidget('w-1', 'Alpha'), makeWidget('w-2', 'Alpha')]);

    const { status, body } = await getJson(`${BASE_URL}/$facets?facet=name`);

    expect(status).toBe(200);
    expect(body).toEqual({
      meta: { type: 'entityFacets', entity: 'widget' },
      data: { name: [{ value: 'Alpha', count: 2 }] },
    });
  });

  it('answers a member the protocol refuses with a 400', async () => {
    useHandlers();

    const { status, body } = await getJson(`${BASE_URL}/$facets?facet=nope`);

    expect(status).toBe(400);
    expect(body).toMatchObject({ code: 'invalidQuery' });
  });
});

describe('entityRestHandlers', () => {
  // Responses are built with the production envelope makers, so a fixture
  // cannot drift from the wire format the adapters parse.
  it('serves a page envelope, honouring the paging query', async () => {
    useHandlers([
      makeWidget('w-1', 'Alpha'),
      makeWidget('w-2', 'Beta'),
      makeWidget('w-3', 'Gamma'),
    ]);

    const { body } = await getJson(`${BASE_URL}?page=2&pageSize=2`);

    expect(body).toEqual({
      meta: { type: 'entityPage', entity: 'widget' },
      data: {
        items: [{ id: 'w-3', name: 'Gamma' }],
        total: 3,
        request: { page: 2, pageSize: 2 },
      },
    });
  });

  it('defaults the paging query', async () => {
    useHandlers([makeWidget('w-1', 'Alpha')]);

    const { body } = await getJson(BASE_URL);

    expect(body).toMatchObject({
      data: { request: { page: 1, pageSize: 10 } },
    });
  });

  it('serves an empty page with no data at all', async () => {
    useHandlers();

    const { body } = await getJson(BASE_URL);

    expect(body).toMatchObject({ data: { items: [], total: 0 } });
  });

  it('serves one entity, and 404s an unknown id', async () => {
    useHandlers([makeWidget('w-1', 'Alpha')]);

    expect((await getJson(`${BASE_URL}/w-1`)).body).toEqual({
      meta: { type: 'entity', entity: 'widget' },
      data: { id: 'w-1', name: 'Alpha' },
    });
    expect((await fetch(`${BASE_URL}/missing`)).status).toBe(404);
  });

  // The service is what mints an id on create; echoing the request back
  // unchanged would hide that the adapter must read the response.
  it('mints an id on create', async () => {
    useHandlers();

    const { status, body } = await getJson(BASE_URL, {
      method: 'POST',
      body: JSON.stringify({ data: { name: 'Alpha' } }),
    });

    expect(status).toBe(201);
    expect((body as { data: { id: string } }).data.id).toBe('generated-1');
    expect(rows).toHaveLength(1);
  });

  it('keeps an id the caller supplied on create', async () => {
    useHandlers();

    const { body } = await getJson(BASE_URL, {
      method: 'POST',
      body: JSON.stringify({ data: { id: 'w-9', name: 'Alpha' } }),
    });

    expect((body as { data: { id: string } }).data.id).toBe('w-9');
  });

  it('replaces on update', async () => {
    useHandlers([makeWidget('w-1', 'Alpha')]);

    await getJson(`${BASE_URL}/w-1`, {
      method: 'PUT',
      body: JSON.stringify({ data: { id: 'w-1', name: 'Renamed' } }),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Renamed');
  });

  it('appends on update of a row it does not have', async () => {
    useHandlers();

    await getJson(`${BASE_URL}/w-9`, {
      method: 'PUT',
      body: JSON.stringify({ data: { id: 'w-9', name: 'New' } }),
    });

    expect(rows).toHaveLength(1);
  });

  // A delete answers with the removed entity's envelope rather than a bare
  // `204`: the shared fetch client always parses the response as JSON.
  it('answers a delete with an envelope and removes the row', async () => {
    useHandlers([makeWidget('w-1', 'Alpha')]);

    const { body } = await getJson(`${BASE_URL}/w-1`, { method: 'DELETE' });

    expect(body).toMatchObject({ meta: { type: 'entity', entity: 'widget' } });
    expect(rows).toEqual([]);
  });

  it('answers a delete of an unknown id with an empty envelope', async () => {
    useHandlers([makeWidget('w-1', 'Alpha')]);

    const { body } = await getJson(`${BASE_URL}/missing`, { method: 'DELETE' });

    expect(body).toEqual({
      meta: { type: 'entity', entity: 'widget' },
      data: {},
    });
    expect(rows).toHaveLength(1);
  });
});

describe('respondWithEntity', () => {
  it('serves one entity for a single endpoint', async () => {
    server.use(respondWithEntity(BASE_URL, Widget, makeWidget('w-1', 'Alpha')));

    expect((await getJson(BASE_URL)).body).toEqual({
      meta: { type: 'entity', entity: 'widget' },
      data: { id: 'w-1', name: 'Alpha' },
    });
  });
});

// These are what make the adapters' error branches reachable at all.
describe('the failure handlers', () => {
  it.each([
    ['500', () => respondWith500(BASE_URL), 500],
    ['404', () => respondWith404(BASE_URL), 404],
  ])('respondWith%s answers that status', async (_label, handler, status) => {
    server.use(handler());

    expect((await fetch(BASE_URL)).status).toBe(status);
  });

  it('respondWithProblem answers a failure as a service does', async () => {
    server.use(respondWithProblem(BASE_URL, new DuplicateKey({ key: 'slug' })));

    const response = await fetch(BASE_URL);

    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
    expect(await response.json()).toMatchObject({
      code: 'duplicateKey',
      key: 'slug',
    });
  });

  it('respondWithMalformedEnvelope answers 200 with a non-envelope body', async () => {
    server.use(respondWithMalformedEnvelope(BASE_URL));

    const { status, body } = await getJson(BASE_URL);

    expect(status).toBe(200);
    expect(body).toEqual({ id: 'raw', name: 'not an envelope' });
  });

  it('respondWithMalformedEnvelope accepts a custom body', async () => {
    server.use(respondWithMalformedEnvelope(BASE_URL, 'get', { other: true }));

    expect((await getJson(BASE_URL)).body).toEqual({ other: true });
  });

  it('respondWithNonJson answers a body that cannot be parsed', async () => {
    server.use(respondWithNonJson(BASE_URL));

    await expect((await fetch(BASE_URL)).json()).rejects.toThrow();
  });

  it('respondWithNetworkError drops the connection', async () => {
    server.use(respondWithNetworkError(BASE_URL));

    await expect(fetch(BASE_URL)).rejects.toThrow();
  });

  it.each(['post', 'put', 'delete'] as const)(
    'targets the %s method on request',
    async method => {
      server.use(respondWith500(BASE_URL, method));

      expect(
        (await fetch(BASE_URL, { method: method.toUpperCase() })).status,
      ).toBe(500);
    },
  );
});
