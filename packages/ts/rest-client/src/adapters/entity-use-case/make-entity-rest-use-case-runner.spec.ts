import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  Failure,
  PROBLEM_CONTENT_TYPE,
  problemOf,
  type UseCaseDescriptor,
} from '@entifix/core';
import { makeStubUriConfigurationClient } from '@entifix/testing-unit';
import {
  http,
  HttpResponse,
  setupEntifixServer,
} from '@entifix/testing-unit/http';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeEntityRestUseCaseRunner } from './make-entity-rest-use-case-runner.js';

@entity({ key: 'offering' })
class Offering implements Entity {
  #id?: EntityId;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

/** No `key`, so the URL is built from the class name, as every adapter does. */
@entity()
class Ledger implements Entity {
  #id?: EntityId;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

class NoPrice extends Failure.conflict<NoPrice>()(
  'SpecNoPrice',
  'specNoPrice',
) {}

const BASE_URL = 'http://proxy/api/admin/offering';

const runner = makeEntityRestUseCaseRunner(Offering, {
  uriConfig: { key: 'admin.[entity]', group: 'uri' },
  configuration: makeStubUriConfigurationClient(
    { offering: BASE_URL },
    { keyTemplate: 'admin.[entity]', group: 'uri' },
  ),
});

const verb = (key: string, binding: UseCaseDescriptor['binding']) =>
  ({
    key,
    binding,
    placement: 'determining',
    labelKey: key,
  }) as UseCaseDescriptor;

const server = setupEntifixServer();

describe('makeEntityRestUseCaseRunner', () => {
  it('runs a record verb at its derived path under the entity’s base URL', async () => {
    const seen: string[] = [];
    server.use(
      http.post(`${BASE_URL}/:id/publish`, ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return HttpResponse.json({ meta: { type: 'entity' }, data: {} });
      }),
    );

    await Effect.runPromise(runner.run(verb('publish', 'entity'), 'o-1'));

    expect(seen).toEqual(['/api/admin/offering/o-1/publish']);
  });

  it('runs an unbound verb on the collection path', async () => {
    const seen: string[] = [];
    server.use(
      http.post(`${BASE_URL}/reindex`, ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return HttpResponse.json({});
      }),
    );

    await Effect.runPromise(runner.run(verb('reindex', 'unbound')));

    expect(seen).toEqual(['/api/admin/offering/reindex']);
  });

  it('sends a selection in its wire form and answers one outcome per record', async () => {
    let body: unknown;
    server.use(
      http.post(`${BASE_URL}/publish-all`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          meta: { type: 'bulkOutcome', entity: 'offering' },
          data: [{ id: 'o-1', ok: true }],
        });
      }),
    );

    const outcomes = await Effect.runPromise(
      runner.bulk(verb('publish-all', 'collection'), {
        mode: 'ids',
        ids: new Set(['o-1']),
      }),
    );

    expect(body).toEqual({ selection: { mode: 'ids', ids: ['o-1'] } });
    expect(outcomes).toEqual([{ id: 'o-1', ok: true }]);
  });

  it('refuses a bulk answer that is not a bulkOutcome envelope', async () => {
    server.use(
      http.post(`${BASE_URL}/publish-all`, () =>
        HttpResponse.json([{ id: 'o-1', ok: true }]),
      ),
    );

    const failure = await Effect.runPromise(
      Effect.flip(
        runner.bulk(verb('publish-all', 'collection'), {
          mode: 'ids',
          ids: new Set(['o-1']),
        }),
      ),
    );

    expect(failure).toMatchObject({ _tag: 'ProtocolFailure' });
  });

  it('fails with the refusal the service sent', async () => {
    server.use(
      http.post(`${BASE_URL}/:id/publish`, () =>
        HttpResponse.json(problemOf(new NoPrice(), { status: 409 }), {
          status: 409,
          headers: { 'content-type': PROBLEM_CONTENT_TYPE },
        }),
      ),
    );

    const failure = await Effect.runPromise(
      Effect.flip(runner.run(verb('publish', 'entity'), 'o-1')),
    );

    expect(failure).toMatchObject({ _tag: 'SpecNoPrice', code: 'specNoPrice' });
  });

  it('names an unkeyed entity by its class, as its other adapters do', async () => {
    const seen: string[] = [];
    server.use(
      http.post('http://proxy/api/Ledger/close', ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return HttpResponse.json({});
      }),
    );
    const ledgers = makeEntityRestUseCaseRunner(Ledger, {
      uriConfig: { key: 'admin.[entity]', group: 'uri' },
      configuration: makeStubUriConfigurationClient(
        { Ledger: 'http://proxy/api/Ledger' },
        { keyTemplate: 'admin.[entity]', group: 'uri' },
      ),
    });

    await Effect.runPromise(ledgers.run(verb('close', 'collection')));

    expect(seen).toEqual(['/api/Ledger/close']);
  });
});
