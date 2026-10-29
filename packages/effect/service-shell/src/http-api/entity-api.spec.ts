import {
  makeStaticPolicyDecision,
  makeStaticServiceCrossingPolicy,
  PolicyDecisionTag,
  ServiceCrossingPolicyTag,
} from '@entifix/authz';
import {
  defineEntityApi,
  type EntityFacetCounter,
  EntityFacetCounterFactoryTag,
  type EntityRepository,
  EntityRepositoryFactoryTag,
  IdempotencyKeyTag,
  InvalidToken,
  Otherwise,
  type TokenClaims,
  TokenServiceTag,
  type VerbEndpoint,
  verbEndpoint,
  When,
} from '@entifix/business';
import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  Failure,
  IDEMPOTENCY_KEY_HEADER,
  readWireSelection,
  toWireSelection,
  useCase,
} from '@entifix/core';
import {
  makeInMemoryEntityRepository,
  makeInMemoryFacetCounter,
} from '@entifix/testing-unit';
import { Effect, Layer, Schema } from 'effect';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  expectTypeOf,
  it,
} from 'vitest';

import {
  CROSSING_TOKEN_HEADER,
  ORGANIZATION_HEADER,
  ServiceCrossingTokenTag,
} from '../auth/require-service-crossing.js';
import {
  type RunningTestService,
  serveTestService,
} from '../serve-test-service.js';
import { endpointsOf, type ServedRequirements } from './build-api.js';
import { entityApi } from './entity-api.js';

@entity({ domain: 'catalog', key: 'gadget' })
class Gadget implements Entity {
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

@useCase({
  entity: Gadget,
  key: 'polish',
  binding: 'entity',
  placement: 'determining',
  labelKey: 'x',
  variants: 'polishing',
})
class PolishGadget {}
void PolishGadget;

@useCase({
  entity: Gadget,
  key: 'inspect',
  binding: 'entity',
  placement: 'determining',
  labelKey: 'y',
})
class InspectGadget {}

@useCase({
  entity: Gadget,
  key: 'tally',
  binding: 'collection',
  placement: 'context-independent',
  labelKey: 'z',
  success: Schema.Struct({ counted: Schema.Number }),
})
class TallyGadgets {}

@entity({ domain: 'catalog', key: 'order' })
class Order implements Entity {
  #id?: EntityId;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

@useCase({
  entity: Order,
  key: 'ship',
  binding: 'entity',
  placement: 'determining',
  labelKey: 'ship',
})
class ShipOrder {}

/** The same verb over a selection: one key, one permission, two bindings. */
@useCase({
  entity: Order,
  key: 'ship',
  binding: 'collection',
  placement: 'context-dependent',
  labelKey: 'ship',
})
class ShipOrders {}

const shipOrder = verbEndpoint(ShipOrder, {
  idempotent: 'unit',
  handler: ({ params }) => Effect.succeed({ shipped: params?.id }),
});

const shipOrders = verbEndpoint(ShipOrders, {
  handler: () => Effect.succeed({ shipped: 'all' }),
});

/** A record verb that also sits in the bulk bar: one class, two cells. */
@useCase({
  entity: Order,
  key: 'archive',
  binding: 'entity',
  placement: 'context-independent',
  alsoAt: [{ binding: 'collection', placement: 'context-dependent' }],
  labelKey: 'archive',
})
class ArchiveOrder {}

const archiveOrder = verbEndpoint(ArchiveOrder, {
  guard: { kind: 'permission' },
  handler: ({ params }) => Effect.succeed({ archived: params?.id }),
  bulk: ({ payload }) => Effect.succeed({ archived: payload }),
});

class NameTaken extends Failure.conflict<NameTaken>()(
  'SpecNameTaken',
  'specNameTaken',
  { name: Schema.String },
) {}

const aGadget = (id: string, name: string, owner = 'ada'): Gadget => {
  const gadget = new Gadget();
  gadget.id = id;
  gadget.name = name;
  gadget.owner = owner;
  return gadget;
};

const stores = new Map<
  string,
  ReturnType<typeof makeInMemoryEntityRepository>
>();
const storeFor = (organizationId = '') => {
  let store = stores.get(organizationId);
  if (store === undefined) {
    store = makeInMemoryEntityRepository();
    stores.set(organizationId, store);
  }
  return store;
};

const POLISHING = {
  variants: {
    polishing: [
      When(context => context.entitlements.includes('shine')).use({
        name: 'buffed',
        impl: undefined,
      }),
    ],
  },
};

const ROWS = [aGadget('g1', 'lamp', 'ada'), aGadget('g2', 'desk', 'bob')];

/** Every verb Gadget declares, served once per group that serves Gadget. */
const gadgetVerbs = [
  verbEndpoint(PolishGadget, {
    handler: ({ params }) => Effect.succeed({ polished: params?.id }),
  }),
  verbEndpoint(InspectGadget, {
    guard: { kind: 'crossing', organization: false },
    handler: () => Effect.succeed({ inspected: true }),
  }),
  verbEndpoint(TallyGadgets, {
    guard: { kind: 'public' },
    handler: ({ payload }) =>
      Effect.succeed({
        counted:
          readWireSelection(
            (payload as { selection: unknown }).selection as never,
          )?.mode === 'ids'
            ? 2
            : 0,
      }),
  }),
];

const gadgets = entityApi(
  defineEntityApi(Gadget, 'gadget', {
    useCases: gadgetVerbs,
    verbs: ['list', 'get', 'create', 'update', 'delete'],
    guard: { read: { kind: 'public' }, write: { kind: 'permission' } },
    facets: true,
    errors: [NameTaken],
    prepare: (gadget, { verb }) =>
      gadget.name === 'taken'
        ? Effect.fail(new NameTaken({ name: 'taken' }))
        : Effect.succeed(
            Object.assign(gadget, {
              owner: verb === 'create' ? 'ada' : gadget.owner,
            }),
          ),
  }),
  { compositions: POLISHING },
);

const owned = entityApi(
  defineEntityApi(Gadget, 'owned-gadget' as 'gadget', {
    useCases: gadgetVerbs,
    verbs: ['list', 'get'],
    guard: { kind: 'organization' },
    facets: true,
    narrowing: [
      When(context => context.partyId === 'nobody').use({
        name: 'nothing',
        impl: () => 'nothing' as const,
      }),
      Otherwise.use({
        name: 'owner',
        impl: context => ({
          operator: 'and' as const,
          values: [
            {
              property: 'owner' as const,
              operator: 'eq' as const,
              value: context.partyId ?? '',
            },
          ],
        }),
      }),
    ],
  }),
  { compositions: POLISHING },
);

const orders = entityApi(
  defineEntityApi(Order, 'order', {
    verbs: ['create', 'get'],
    useCases: [shipOrder, shipOrders, archiveOrder],
    guard: { kind: 'permission' },
    override: {
      create: {
        guard: { kind: 'crossing', organization: true },
        idempotent: 'unit',
        payload: Schema.Struct({ basket: Schema.String }),
        handler: ({ payload }, { organizationId, links }) =>
          Effect.map(IdempotencyKeyTag, key => ({
            meta: {
              type: 'entity',
              entity: 'order',
              links: links.record('o1'),
            },
            data: {
              id: 'o1',
              basket: (payload as { basket: string }).basket,
              organizationId,
              key,
            },
          })),
      },
    },
  }),
);

@entity({ domain: 'catalog', key: 'note' })
class Note implements Entity {
  #id?: EntityId;
  #text?: string;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string' })
  get text(): string | undefined {
    return this.#text;
  }
  set text(value: string | undefined) {
    this.#text = value;
  }
}

// Writes only: its links name neither a list nor a read.
const notes = entityApi(
  defineEntityApi(Note, 'note', {
    verbs: ['create', 'delete'],
    guard: { kind: 'public' },
  }),
);

const fakeTokens = TokenServiceTag.of({
  sign: claims => Effect.succeed(JSON.stringify(claims)),
  verify: token =>
    Effect.try({
      try: () => JSON.parse(token) as TokenClaims,
      catch: () => new InvalidToken(),
    }),
});

const GRANTS = {
  admin: [
    'catalog:gadget:read',
    'catalog:gadget:write',
    'catalog:gadget:delete',
    'catalog:gadget:polish',
    'catalog:gadget:inspect',
    'catalog:order:read',
    'catalog:order:ship',
    'catalog:order:archive',
  ],
  reader: ['catalog:gadget:read'],
  user: [],
} as const;

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
  for (const row of ROWS) {
    await Effect.runPromise(storeFor().save(row));
    await Effect.runPromise(storeFor('org-1').save(row));
  }
  service = await serveTestService({
    name: 'spec-entity-api',
    port: 0,
    slices: ['test'],
    endpoints: [gadgets, owned, orders, notes],
    appLayer: Layer.mergeAll(
      Layer.succeed(EntityRepositoryFactoryTag, {
        for: (_entity, scope) =>
          Effect.succeed(storeFor(scope.organizationId) as EntityRepository),
      }),
      Layer.succeed(EntityFacetCounterFactoryTag, {
        for: () =>
          Effect.succeed(makeInMemoryFacetCounter(ROWS) as EntityFacetCounter),
      }),
      Layer.succeed(TokenServiceTag, fakeTokens),
      Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision(GRANTS)),
      Layer.succeed(ServiceCrossingTokenTag, CROSSING),
      Layer.succeed(
        ServiceCrossingPolicyTag,
        makeStaticServiceCrossingPolicy([
          'catalog:order:write',
          'catalog:gadget:inspect',
        ]),
      ),
    ),
  });
});

afterAll(async () => {
  await service.close();
});

const call = async (path: string, init?: RequestInit) => {
  const response = await fetch(`${service.baseUrl}${path}`, init);
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: (text === '' ? undefined : JSON.parse(text)) as
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a decoded answer, read as deep as each case needs
      Record<string, any> | undefined,
  };
};

const json = (method: string, body: unknown, headers = {}) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

describe('entityApi', () => {
  it('names its group for the key and serves the derived paths', () => {
    expect(gadgets.name).toBe('gadget');
    expect(endpointsOf([gadgets])).toEqual([
      'GET /api/gadget/$metadata',
      'GET /api/gadget/$facets',
      'GET /api/gadget',
      'GET /api/gadget/:id',
      'POST /api/gadget',
      'PUT /api/gadget/:id',
      'DELETE /api/gadget/:id',
      'POST /api/gadget/:id/polish',
      'POST /api/gadget/:id/inspect',
      'POST /api/gadget/tally',
    ]);
  });

  it('types what serving it requires', () => {
    expectTypeOf<ServedRequirements<[typeof gadgets]>>().toEqualTypeOf<
      | EntityRepositoryFactoryTag
      | PolicyDecisionTag
      | EntityFacetCounterFactoryTag
      | TokenServiceTag
      // `inspect` is a crossing verb, so the group reads the crossing tags.
      | ServiceCrossingTokenTag
      | ServiceCrossingPolicyTag
    >();
  });

  it('lists with RSQL against the entity’s own metadata', async () => {
    const answer = await call('/api/gadget?rsql=name==lamp');

    expect(answer.status).toBe(200);
    expect(answer.body?.data.items).toEqual([
      expect.objectContaining({ id: 'g1', name: 'lamp' }),
    ]);
    expect(answer.body?.meta.links).toEqual([
      { rel: 'self', href: '/api/gadget', method: 'GET' },
      { rel: 'create', href: '/api/gadget', method: 'POST' },
      { rel: 'tally', href: '/api/gadget/tally', method: 'POST' },
    ]);
  });

  it('refuses a filter on a member that is not queryable', async () => {
    const answer = await call('/api/gadget?rsql=id==g1');

    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ code: 'invalidQuery' });
  });

  it('reads one record, and answers a missing one with a 404 problem', async () => {
    const found = await call('/api/gadget/g1');
    const missing = await call('/api/gadget/nope');

    expect(found.body?.data).toMatchObject({ id: 'g1', name: 'lamp' });
    expect(found.body?.meta.links).toContainEqual({
      rel: 'update',
      href: '/api/gadget/g1',
      method: 'PUT',
    });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: 'notFound' });
  });

  it('creates, updates and deletes under the write permission', async () => {
    const refused = await call(
      '/api/gadget',
      json(
        'POST',
        { meta: { type: 'entity', entity: 'gadget' }, data: { name: 'rug' } },
        bearer(['reader']),
      ),
    );
    const created = await call(
      '/api/gadget',
      json(
        'POST',
        { meta: { type: 'entity', entity: 'gadget' }, data: { name: 'rug' } },
        bearer(['admin']),
      ),
    );
    const id = created.body?.data.id as string;
    const updated = await call(
      `/api/gadget/${id}`,
      json(
        'PUT',
        {
          meta: { type: 'entity', entity: 'gadget' },
          data: { id: 'other', name: 'mat' },
        },
        bearer(['admin']),
      ),
    );
    const removed = await call(`/api/gadget/${id}`, {
      method: 'DELETE',
      headers: bearer(['admin']),
    });

    expect(refused.status).toBe(403);
    expect(created.body?.data).toMatchObject({ name: 'rug', owner: 'ada' });
    expect(updated.body?.data).toMatchObject({ id, name: 'mat' });
    expect(removed.body).toEqual({
      meta: {
        type: 'entity',
        entity: 'gadget',
        links: [
          { rel: 'self', href: '/api/gadget', method: 'GET' },
          { rel: 'create', href: '/api/gadget', method: 'POST' },
          { rel: 'tally', href: '/api/gadget/tally', method: 'POST' },
        ],
      },
      data: { id },
    });
  });

  it('answers a prepare refusal with its problem', async () => {
    const answer = await call(
      '/api/gadget',
      json(
        'POST',
        { meta: { type: 'entity', entity: 'gadget' }, data: { name: 'taken' } },
        bearer(['admin']),
      ),
    );

    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ code: 'specNameTaken', name: 'taken' });
  });

  it('refuses a body that is not an envelope', async () => {
    const answer = await call(
      '/api/gadget',
      json('POST', { name: 'rug' }, bearer(['admin'])),
    );

    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ code: 'invalid' });
  });

  it('serves $metadata filtered by the principal, never captured by /:id', async () => {
    const admin = await call('/api/gadget/$metadata', {
      headers: bearer(['admin']),
    });
    const reader = await call('/api/gadget/$metadata', {
      headers: bearer(['reader']),
    });
    const stranger = await call('/api/gadget/$metadata', {
      headers: bearer(['user']),
    });
    const anonymous = await call('/api/gadget/$metadata');

    const entitled = await call('/api/gadget/$metadata', {
      headers: bearer(['admin'], { entitlements: ['shine'] }),
    });

    expect(admin.body?.data.actions).toEqual(['read', 'write', 'delete']);
    // A verb the caller resolves to nothing is omitted; one with nothing to
    // resolve is listed as declared.
    expect(admin.body?.data.useCases).toEqual([
      expect.objectContaining({ key: 'inspect' }),
    ]);
    // The contract stays on the server: no schema reaches the document.
    expect(JSON.stringify(admin.body)).not.toContain('success');
    expect(entitled.body?.data.useCases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'inspect' }),
        expect.objectContaining({
          key: 'polish',
          composition: { useCase: 'polish', variant: 'buffed' },
        }),
      ]),
    );
    expect(reader.body?.data).toMatchObject({
      actions: ['read'],
      useCases: [],
    });
    expect(stranger.status).toBe(404);
    expect(anonymous.status).toBe(401);
  });

  it('answers 304 when the computed document did not change', async () => {
    const first = await call('/api/gadget/$metadata', {
      headers: bearer(['admin']),
    });
    const etag = first.headers.get('etag') ?? '';
    const again = await call('/api/gadget/$metadata', {
      headers: { ...bearer(['admin']), 'if-none-match': etag },
    });

    expect(again.status).toBe(304);
  });

  it('counts facets, and refuses a facet on a member it cannot count', async () => {
    const counts = await call('/api/gadget/$facets?facet=owner');
    const refused = await call('/api/gadget/$facets?facet=nope');

    expect(counts.body?.data).toEqual({
      owner: expect.arrayContaining([
        { value: 'ada', count: 1 },
        { value: 'bob', count: 1 },
      ]),
    });
    expect(refused.status).toBe(400);
  });
});

describe('entityApi under an organization guard and a narrowing', () => {
  const asOwner = (partyId: string) =>
    bearer(['reader'], { activeOrganizationId: 'org-1', partyId });

  it('lists only what the narrowing leaves the caller', async () => {
    const answer = await call('/api/owned-gadget', { headers: asOwner('bob') });

    expect(answer.body?.data.items).toEqual([
      expect.objectContaining({ id: 'g2', owner: 'bob' }),
    ]);
  });

  it('reads another owner’s record as absent, never forbidden', async () => {
    const mine = await call('/api/owned-gadget/g2', {
      headers: asOwner('bob'),
    });
    const theirs = await call('/api/owned-gadget/g1', {
      headers: asOwner('bob'),
    });

    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(404);
  });

  it('answers an empty page and a 404 to a caller left with nothing', async () => {
    const page = await call('/api/owned-gadget', {
      headers: asOwner('nobody'),
    });
    const one = await call('/api/owned-gadget/g1', {
      headers: asOwner('nobody'),
    });

    expect(page.body?.data).toMatchObject({ items: [], total: 0 });
    expect(one.status).toBe(404);
  });

  it('counts only what the narrowing leaves, and nothing for nobody', async () => {
    const bob = await call('/api/owned-gadget/$facets?facet=owner', {
      headers: asOwner('bob'),
    });
    const nobody = await call('/api/owned-gadget/$facets?facet=owner', {
      headers: asOwner('nobody'),
    });

    expect(bob.body?.data).toEqual({ owner: [{ value: 'bob', count: 1 }] });
    expect(nobody.body?.data).toEqual({ owner: [] });
  });
});

describe('an overridden verb', () => {
  it('keeps the path and takes its own guard, payload and idempotency', async () => {
    const answer = await call(
      '/api/order',
      json(
        'POST',
        { basket: 'b-1' },
        {
          [CROSSING_TOKEN_HEADER]: CROSSING,
          [ORGANIZATION_HEADER]: 'org-9',
          [IDEMPOTENCY_KEY_HEADER]: '"flow-1:place"',
        },
      ),
    );
    const sessioned = await call(
      '/api/order',
      json('POST', { basket: 'b-1' }, bearer(['admin'])),
    );

    expect(answer.body?.data).toEqual({
      id: 'o1',
      basket: 'b-1',
      organizationId: 'org-9',
      key: 'flow-1:place',
    });
    expect(sessioned.status).toBe(401);
  });
});

describe('a group that serves writes only', () => {
  it('links nothing it does not serve', async () => {
    const created = await call(
      '/api/note',
      json('POST', {
        meta: { type: 'entity', entity: 'note' },
        data: { text: 'hi' },
      }),
    );
    const id = created.body?.data.id as string;
    const removed = await call(`/api/note/${id}`, { method: 'DELETE' });

    expect(created.body?.meta.links).toEqual([
      { rel: 'delete', href: `/api/note/${id}`, method: 'DELETE' },
    ]);
    expect(removed.body?.meta.links).toEqual([
      { rel: 'create', href: '/api/note', method: 'POST' },
    ]);
  });
});

describe('verbs derived from @useCase()', () => {
  it('links a verb on a record only for a principal the policy permits', async () => {
    const admin = await call('/api/gadget/g1', { headers: bearer(['admin']) });
    const anonymous = await call('/api/gadget/g1');

    expect(admin.body?.meta.links).toContainEqual({
      rel: 'polish',
      href: '/api/gadget/g1/polish',
      method: 'POST',
    });
    expect(anonymous.body?.meta.links).not.toContainEqual(
      expect.objectContaining({ rel: 'polish' }),
    );
  });

  it('never links a crossing verb, though it serves it', async () => {
    const admin = await call('/api/gadget/g1', { headers: bearer(['admin']) });
    const crossed = await call('/api/gadget/g1/inspect', {
      method: 'POST',
      headers: { [CROSSING_TOKEN_HEADER]: CROSSING },
    });

    expect(admin.body?.meta.links).not.toContainEqual(
      expect.objectContaining({ rel: 'inspect' }),
    );
    expect(crossed.body).toEqual({ inspected: true });
  });

  it('runs a record verb at its derived path under its derived permission', async () => {
    const allowed = await call('/api/gadget/g1/polish', {
      method: 'POST',
      headers: bearer(['admin']),
    });
    const refused = await call('/api/gadget/g1/polish', {
      method: 'POST',
      headers: bearer(['reader']),
    });

    expect(allowed.body).toEqual({ polished: 'g1' });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ permission: 'catalog:gadget:polish' });
  });

  it('runs a collection verb on a selection, answering its described success', async () => {
    const answer = await call(
      '/api/gadget/tally',
      json('POST', {
        selection: toWireSelection({ mode: 'ids', ids: new Set(['g1', 'g2']) }),
      }),
    );

    expect(answer.body).toEqual({ counted: 2 });
  });

  it('carries the idempotency a verb declares onto its endpoint', () => {
    const ship = orders.endpoints.find(
      ({ descriptor }) => descriptor.name === 'ship',
    );

    expect(ship?.descriptor).toMatchObject({
      path: '/api/order/:id/ship',
      idempotent: 'unit',
      useCase: 'ship',
    });
  });

  it('serves one key on a record and over a selection, under two names', () => {
    const shipping = orders.endpoints
      .filter(({ descriptor }) => descriptor.useCase === 'ship')
      .map(({ descriptor }) => [descriptor.name, descriptor.path]);

    expect(shipping).toEqual([
      ['ship', '/api/order/:id/ship'],
      ['ship-collection', '/api/order/ship'],
    ]);
  });

  it('serves a record verb’s collection cell from its bulk handler', () => {
    const archiving = orders.endpoints
      .filter(({ descriptor }) => descriptor.useCase === 'archive')
      .map(({ descriptor }) => [descriptor.name, descriptor.path]);

    expect(archiving).toEqual([
      ['archive', '/api/order/:id/archive'],
      ['archive-collection', '/api/order/archive'],
    ]);
  });

  it('answers the collection cell over the selection it was sent', async () => {
    const answer = await call(
      '/api/order/archive',
      json(
        'POST',
        { selection: { mode: 'ids', ids: ['o1'] } },
        bearer(['admin']),
      ),
    );

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({
      archived: { selection: { mode: 'ids', ids: ['o1'] } },
    });
  });

  it('refuses a collection cell with no bulk handler, and a bulk handler with no cell', () => {
    const serve = (verbs: readonly VerbEndpoint<never>[]) => () =>
      entityApi(
        defineEntityApi(Order, 'order', {
          verbs: ['get'],
          guard: { kind: 'permission' },
          useCases: [shipOrder, shipOrders, ...verbs],
        }),
      );

    expect(
      serve([
        verbEndpoint(ArchiveOrder, {
          handler: () => Effect.succeed('one'),
        }),
      ]),
    ).toThrow("serve no bulk handler for @useCase() 'archive'");
    expect(() =>
      entityApi(
        defineEntityApi(Order, 'order', {
          verbs: ['get'],
          guard: { kind: 'permission' },
          useCases: [
            verbEndpoint(ShipOrder, {
              handler: () => Effect.succeed('one'),
              bulk: () => Effect.succeed('all'),
            }),
            shipOrders,
            archiveOrder,
          ],
        }),
      ),
    ).toThrow("serve a bulk handler for @useCase() 'ship'");
  });

  it('refuses a group that serves only one binding of a verb declared on both', () => {
    expect(() =>
      entityApi(
        defineEntityApi(Order, 'order', {
          verbs: ['get'],
          guard: { kind: 'permission' },
          useCases: [shipOrder, archiveOrder],
        }),
      ),
    ).toThrow("serve no endpoint for @useCase() 'ship'");
  });

  it('refuses to build a group that leaves a declared verb without an endpoint', () => {
    expect(() =>
      entityApi(
        defineEntityApi(Gadget, 'gadget', {
          verbs: ['get'],
          guard: { kind: 'public' },
        }),
        { compositions: POLISHING },
      ),
    ).toThrow(
      "the 'gadget' endpoints serve no endpoint for @useCase() 'polish', 'inspect', 'tally'",
    );
  });

  it('refuses to build a group that serves another entity’s verb', () => {
    expect(() =>
      entityApi(
        defineEntityApi(Gadget, 'gadget', {
          verbs: ['get'],
          guard: { kind: 'public' },
          useCases: [...gadgetVerbs, shipOrder],
        }),
        { compositions: POLISHING },
      ),
    ).toThrow("serve 'ship', declared on another entity");
  });
});
