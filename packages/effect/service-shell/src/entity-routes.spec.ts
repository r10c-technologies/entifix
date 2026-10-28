import {
  makeStaticPolicyDecision,
  makeStaticServiceCrossingPolicy,
  PolicyDecisionTag,
  ServiceCrossingPolicyTag,
} from '@entifix/authz';
import {
  type EntityRepository,
  EntityRepositoryFactoryTag,
  type TokenClaims,
  TokenServiceTag,
} from '@entifix/business';
import {
  accessor,
  EntifixBuildError,
  EntifixConnError,
  type Entity,
  entity,
  type EntityId,
} from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { Effect, Layer } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CROSSING_TOKEN_HEADER,
  ORGANIZATION_HEADER,
  ServiceCrossingTokenTag,
} from './auth/index.js';
import {
  type EntityReadScope,
  EntityRouteRefusal,
  makeEntityRoutes,
} from './entity-routes.js';
import {
  type RunningTestService,
  serveTestService,
} from './serve-test-service.js';

@entity({ domain: 'catalog', key: 'widget' })
class Widget implements Entity {
  #id?: EntityId;
  #name?: string;
  #owner?: string;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', filterable: true, sortable: true })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }

  @accessor({ type: 'string', filterable: true })
  get owner(): string | undefined {
    return this.#owner;
  }
  set owner(value: string | undefined) {
    this.#owner = value;
  }
}

const aWidget = (id: string, name: string, owner = 'ada'): Widget => {
  const widget = new Widget();
  widget.id = id;
  widget.name = name;
  widget.owner = owner;
  return widget;
};

/** One repository per organization, and one for a request that names none. */
const stores = new Map<
  string,
  ReturnType<typeof makeInMemoryEntityRepository>
>();
const storeFor = (organizationId = '') => {
  let store = stores.get(organizationId);
  if (!store) {
    store = makeInMemoryEntityRepository();
    stores.set(organizationId, store);
  }
  return store;
};
let factoryFailure: EntifixConnError | undefined;

const factory = Layer.succeed(EntityRepositoryFactoryTag, {
  for: (_entity, scope) =>
    factoryFailure
      ? Effect.fail(factoryFailure)
      : Effect.succeed(storeFor(scope.organizationId) as EntityRepository),
});

const envelope = (fields: Record<string, unknown>) => ({
  meta: { type: 'entity', entity: 'widget' },
  data: fields,
});

const ownerScope = (owner: string): EntityReadScope<Widget> => ({
  filter: {
    operator: 'and',
    values: [{ property: 'owner', operator: 'eq', value: owner }],
  },
  includes: (widget: Widget) => widget.owner === owner,
});

const router = Layer.mergeAll(
  // Reads public, writes guarded, every verb: the vocabulary shape.
  makeEntityRoutes(Widget, {
    verbs: ['list', 'get', 'create', 'update', 'delete'],
    guard: { read: { kind: 'public' }, write: { kind: 'permission' } },
    prepare: (widget, { verb }) =>
      widget.name === 'taken'
        ? Effect.fail(new EntityRouteRefusal(409, 'nameTaken', 'pick another'))
        : widget.name === 'reserved'
          ? Effect.fail(new EntityRouteRefusal(422, 'nameReserved'))
          : widget.name === 'shouty'
            ? Effect.fail(
                Object.assign(new EntifixBuildError('no capitals'), {
                  code: 'nameNotLowercase',
                }),
              )
            : widget.name === 'plain-invalid'
              ? Effect.fail(new EntifixBuildError('just invalid'))
              : Effect.succeed(
                  Object.assign(widget, {
                    name: verb === 'create' ? widget.name : `${widget.name}!`,
                  }),
                ),
  }),
  // Per organization, read only, narrowed to the caller.
  makeEntityRoutes(Widget, {
    basePath: '/api/tenant/widget',
    verbs: ['list', 'get'],
    guard: { kind: 'organization' },
    scope: ({ principal }) =>
      Effect.succeed(
        principal?.subject === 'nobody'
          ? 'none'
          : ownerScope(principal?.subject ?? ''),
      ),
  }),
  // Write only, no prepare: a record's links name no read it cannot serve.
  makeEntityRoutes(Widget, {
    basePath: '/api/write-only/widget',
    verbs: ['create'],
    guard: { kind: 'public' },
  }),
  // The fleet naming an organization, and the fleet naming none.
  makeEntityRoutes(Widget, {
    basePath: '/api/crossed/widget',
    verbs: ['list'],
    guard: { kind: 'crossing', organization: true },
  }),
  // `R` named, the entity and the guard still inferred.
  makeEntityRoutes.for<never>()(Widget, {
    basePath: '/api/curried/widget',
    verbs: ['list'],
    guard: { kind: 'public' },
  }),
  makeEntityRoutes(Widget, {
    basePath: '/api/platform/widget',
    verbs: ['create'],
    guard: { kind: 'crossing', organization: false },
    override: {
      create: (_context, links) =>
        HttpServerResponse.json({
          overridden: true,
          links: links.collection(),
        }),
    },
  }),
);

const GRANTS = {
  editor: [
    'catalog:widget:read',
    'catalog:widget:write',
    'catalog:widget:delete',
  ],
  reader: ['catalog:widget:read'],
} as const;

const fakeTokens = TokenServiceTag.of({
  sign: claims => Effect.succeed(JSON.stringify(claims)),
  verify: token =>
    Effect.try({
      try: () => JSON.parse(token) as TokenClaims,
      catch: () => new EntifixBuildError('invalid token'),
    }),
});

const bearer = (
  roles: readonly string[],
  extra: Partial<TokenClaims> = {},
) => ({
  Authorization: `Bearer ${JSON.stringify({
    userId: 'u-1',
    subject: 'ada',
    sessionId: 's-1',
    roles,
    ...extra,
  } satisfies TokenClaims)}`,
});

const CROSSING = 'spec-crossing-token';

let service: RunningTestService;

beforeAll(async () => {
  service = await serveTestService({
    name: 'spec-entity-routes',
    port: 0,
    slices: ['test'],
    router,
    appLayer: Layer.mergeAll(
      factory,
      Layer.succeed(TokenServiceTag, fakeTokens),
      Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision(GRANTS)),
      Layer.succeed(ServiceCrossingTokenTag, CROSSING),
      Layer.succeed(
        ServiceCrossingPolicyTag,
        makeStaticServiceCrossingPolicy([
          'catalog:widget:read',
          'catalog:widget:write',
        ]),
      ),
    ),
  });
});

afterAll(async () => {
  await service.close();
});

const call = (path: string, init?: RequestInit) =>
  fetch(`${service.baseUrl}${path}`, init);

const json = (method: string, body: unknown, headers = {}) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

describe('makeEntityRoutes, public reads and guarded writes', () => {
  beforeAll(() => {
    storeFor().seed([aWidget('w-1', 'alpha'), aWidget('w-2', 'beta')]);
  });

  it('lists through the load use case, with links for exactly the verbs mounted', async () => {
    const res = await call('/api/widget?sort=-name');
    const body = (await res.json()) as {
      meta: { links: unknown[] };
      data: { items: Array<{ name: string }> };
    };

    expect(res.status).toBe(200);
    expect(body.data.items.map(item => item.name)).toEqual(['beta', 'alpha']);
    expect(body.meta.links).toEqual([
      { rel: 'self', href: '/api/widget', method: 'GET' },
      { rel: 'create', href: '/api/widget', method: 'POST' },
    ]);
  });

  it('refuses a query naming a member the entity did not declare filterable', async () => {
    const res = await call('/api/widget?rsql=id==w-1');

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'invalidQuery' });
  });

  it('reads one record with its affordances, and 404s an absent one', async () => {
    const found = await call('/api/widget/w-1');
    const missing = await call('/api/widget/w-404');

    expect(found.status).toBe(200);
    expect(
      (
        (await found.json()) as { meta: { links: Array<{ rel: string }> } }
      ).meta.links.map(link => link.rel),
    ).toEqual(['self', 'list', 'update', 'delete']);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      code: 'notFound',
      entity: 'widget',
    });
  });

  it('serves the entity’s metadata at a literal path', async () => {
    const res = await call('/api/widget/$metadata', {
      headers: bearer(['editor']),
    });

    expect(res.status).toBe(200);
  });

  it('refuses an anonymous write and a write the role is not granted', async () => {
    const anonymous = await call(
      '/api/widget',
      json('POST', envelope({ name: 'x' })),
    );
    const reader = await call(
      '/api/widget',
      json('POST', envelope({ name: 'x' }), bearer(['reader'])),
    );

    expect(anonymous.status).toBe(401);
    expect(reader.status).toBe(403);
  });

  it('creates, then updates with the id the path names, through prepare', async () => {
    const created = (await (
      await call(
        '/api/widget',
        json('POST', envelope({ name: 'gamma' }), bearer(['editor'])),
      )
    ).json()) as { data: { id: string; name: string } };
    const updated = await call(
      '/api/widget/w-2',
      json(
        'PUT',
        envelope({ id: 'w-elsewhere', name: 'beta' }),
        bearer(['editor']),
      ),
    );

    expect(created.data.name).toBe('gamma');
    expect(created.data.id).toBeTruthy();
    expect(updated.status).toBe(200);
    expect(storeFor().items.find(item => item.id === 'w-2')).toMatchObject({
      name: 'beta!',
    });
    expect(storeFor().items.some(item => item.id === 'w-elsewhere')).toBe(
      false,
    );
  });

  it('answers a refusal with its own status and code', async () => {
    const save = (name: string) =>
      call('/api/widget', json('POST', envelope({ name }), bearer(['editor'])));

    const taken = await save('taken');
    const reserved = await save('reserved');
    const shouty = await save('shouty');
    const plain = await save('plain-invalid');

    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({
      code: 'nameTaken',
      detail: 'pick another',
    });
    expect(reserved.status).toBe(422);
    expect(await reserved.json()).toMatchObject({
      code: 'nameReserved',
    });
    expect(shouty.status).toBe(400);
    expect(await shouty.json()).toMatchObject({ code: 'nameNotLowercase' });
    expect(await plain.json()).toMatchObject({ code: 'invalidBody' });
  });

  it('refuses a body that is not an envelope as invalid', async () => {
    const res = await call(
      '/api/widget',
      json('POST', { not: 'an envelope' }, bearer(['editor'])),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'invalidEnvelope' });
  });

  it('deletes, answering an envelope', async () => {
    const res = await call('/api/widget/w-1', {
      method: 'DELETE',
      headers: bearer(['editor']),
    });

    expect(await res.json()).toEqual({
      meta: {
        type: 'entity',
        entity: 'widget',
        links: [
          { rel: 'self', href: '/api/widget', method: 'GET' },
          { rel: 'create', href: '/api/widget', method: 'POST' },
        ],
      },
      data: { id: 'w-1' },
    });
  });

  it('answers a store that is not there as a 503 on every verb', async () => {
    factoryFailure = new EntifixConnError('no pool');
    try {
      const editor = bearer(['editor']);
      const statuses = await Promise.all([
        call('/api/widget').then(res => res.status),
        call('/api/widget/w-2').then(res => res.status),
        call('/api/widget', json('POST', envelope({ name: 'x' }), editor)).then(
          res => res.status,
        ),
        call('/api/widget/w-2', { method: 'DELETE', headers: editor }).then(
          res => res.status,
        ),
      ]);

      expect(statuses).toEqual([503, 503, 503, 503]);
    } finally {
      factoryFailure = undefined;
    }
  });
});

describe('makeEntityRoutes.for, naming the services alone', () => {
  it('serves the route set it derives', async () => {
    const res = await call('/api/curried/widget');

    expect(res.status).toBe(200);
  });

  it('refuses explicit type arguments that leave the guard to default', () => {
    // Compile-time only, and never called. Naming `R` in a single call stops
    // inference of `G`, and `never` is what it defaults to, so the guard is
    // refused here rather than widening to every kind and dragging the
    // crossing tags into a session-guarded host.
    void (() =>
      makeEntityRoutes<Widget, never>(Widget, {
        verbs: ['list'],
        // @ts-expect-error — `G` defaults to `never` once `R` is named.
        guard: { kind: 'public' },
      }));
    expect(makeEntityRoutes.for).toBeTypeOf('function');
  });
});

describe('makeEntityRoutes, write only', () => {
  it('links a created record to nothing it does not serve', async () => {
    const res = await call(
      '/api/write-only/widget',
      json('POST', envelope({ name: 'delta' })),
    );
    const body = (await res.json()) as { meta: { links: unknown[] } };

    expect(res.status).toBe(200);
    expect(body.meta.links).toEqual([]);
  });
});

describe('makeEntityRoutes, per organization and scoped to the caller', () => {
  beforeAll(() => {
    storeFor('org-1').seed([
      aWidget('t-1', 'mine', 'ada'),
      aWidget('t-2', 'theirs', 'grace'),
    ]);
  });

  const asAda = bearer(['reader'], { activeOrganizationId: 'org-1' });

  it('lists only the caller’s records, from the caller’s organization', async () => {
    const res = await call('/api/tenant/widget', { headers: asAda });
    const body = (await res.json()) as {
      data: { items: Array<{ id: string }> };
    };

    expect(body.data.items.map(item => item.id)).toEqual(['t-1']);
  });

  it('answers a record outside the caller’s scope exactly as an absent one', async () => {
    const mine = await call('/api/tenant/widget/t-1', { headers: asAda });
    const theirs = await call('/api/tenant/widget/t-2', { headers: asAda });

    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(404);
  });

  it('gives a caller who owns nothing an empty page and a 404, never a 403', async () => {
    const nobody = bearer(['reader'], {
      activeOrganizationId: 'org-1',
      subject: 'nobody',
    });

    const page = await call('/api/tenant/widget', { headers: nobody });
    const record = await call('/api/tenant/widget/t-1', { headers: nobody });

    expect(page.status).toBe(200);
    expect(
      ((await page.json()) as { data: { total: number } }).data.total,
    ).toBe(0);
    expect(record.status).toBe(404);
  });

  it('still refuses a malformed query from a caller who owns nothing', async () => {
    const res = await call('/api/tenant/widget?rsql=id==t-1', {
      headers: bearer(['reader'], {
        activeOrganizationId: 'org-1',
        subject: 'nobody',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('refuses a session with no active organization', async () => {
    const res = await call('/api/tenant/widget', {
      headers: bearer(['reader']),
    });

    expect(res.status).toBe(409);
  });
});

describe('makeEntityRoutes, behind a crossing', () => {
  beforeAll(() => {
    storeFor('org-2').seed([aWidget('c-1', 'crossed')]);
  });

  it('opens the organization the fleet names', async () => {
    const res = await call('/api/crossed/widget', {
      headers: {
        [CROSSING_TOKEN_HEADER]: CROSSING,
        [ORGANIZATION_HEADER]: 'org-2',
      },
    });
    const body = (await res.json()) as {
      data: { items: Array<{ id: string }> };
    };

    expect(body.data.items.map(item => item.id)).toEqual(['c-1']);
  });

  it('refuses a session where a crossing is required', async () => {
    const res = await call('/api/crossed/widget', {
      headers: bearer(['editor']),
    });

    expect(res.status).toBe(401);
  });

  it('runs an override under the derived guard, with the derived links', async () => {
    const refused = await call('/api/platform/widget', { method: 'POST' });
    const res = await call('/api/platform/widget', {
      method: 'POST',
      headers: { [CROSSING_TOKEN_HEADER]: CROSSING },
    });

    expect(refused.status).toBe(401);
    expect(await res.json()).toEqual({
      overridden: true,
      links: [{ rel: 'create', href: '/api/platform/widget', method: 'POST' }],
    });
  });
});
