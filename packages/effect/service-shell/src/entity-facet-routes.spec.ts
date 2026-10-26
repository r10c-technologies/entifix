import { makeStaticPolicyDecision, PolicyDecisionTag } from '@entifix/authz';
import {
  type EntityFacetCounter,
  EntityFacetCounterFactoryTag,
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
import { makeInMemoryFacetCounter } from '@entifix/testing-unit';
import { Effect, Layer } from 'effect';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { makeEntityFacetRoutes } from './entity-facet-routes.js';
import {
  type RunningTestService,
  serveTestService,
} from './serve-test-service.js';

@entity({ domain: 'catalog', key: 'widget' })
class Widget implements Entity {
  #id?: EntityId;
  #brand?: string;
  #owner?: string;
  #note?: string;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', filterable: true })
  get brand(): string | undefined {
    return this.#brand;
  }
  set brand(value: string | undefined) {
    this.#brand = value;
  }

  @accessor({ type: 'string', filterable: true })
  get owner(): string | undefined {
    return this.#owner;
  }
  set owner(value: string | undefined) {
    this.#owner = value;
  }

  @accessor({ type: 'string', filterable: false })
  get note(): string | undefined {
    return this.#note;
  }
  set note(value: string | undefined) {
    this.#note = value;
  }
}

const aWidget = (id: string, brand: string, owner: string): Widget =>
  Object.assign(new Widget(), { id, brand, owner });

const ROWS = [
  aWidget('w-1', 'aurora', 'ada'),
  aWidget('w-2', 'aurora', 'alan'),
  aWidget('w-3', 'terra', 'ada'),
];

const opened: { organizationId?: string }[] = [];
let failure: EntifixConnError | undefined;

const factory = Layer.succeed(EntityFacetCounterFactoryTag, {
  for: (_entity, scope) => {
    opened.push(scope);
    return failure
      ? Effect.fail(failure)
      : Effect.succeed(makeInMemoryFacetCounter(ROWS) as EntityFacetCounter);
  },
});

const router = Layer.mergeAll(
  makeEntityFacetRoutes(Widget, { guard: { kind: 'public' } }),
  makeEntityFacetRoutes(Widget, {
    basePath: '/api/tenant/widget',
    guard: { kind: 'organization' },
    scope: ({ principal }) =>
      Effect.succeed(
        principal?.subject === 'nobody'
          ? ('none' as const)
          : principal?.subject === 'everyone'
            ? ('all' as const)
            : {
                filter: {
                  operator: 'and' as const,
                  values: [
                    {
                      property: 'owner' as const,
                      operator: 'eq' as const,
                      value: principal?.subject,
                    },
                  ],
                },
                includes: (widget: Widget) =>
                  widget.owner === principal?.subject,
              },
      ),
  }),
);

const fakeTokens = TokenServiceTag.of({
  sign: claims => Effect.succeed(JSON.stringify(claims)),
  verify: token =>
    Effect.try({
      try: () => JSON.parse(token) as TokenClaims,
      catch: () => new EntifixBuildError('invalid token'),
    }),
});

const as = (subject: string) => ({
  Authorization: `Bearer ${JSON.stringify({
    userId: 'u-1',
    subject,
    sessionId: 's-1',
    roles: ['reader'],
    activeOrganizationId: 'org-1',
  } satisfies TokenClaims)}`,
});

let service: RunningTestService;

beforeAll(async () => {
  service = await serveTestService({
    name: 'spec-entity-facet-routes',
    port: 0,
    slices: ['test'],
    router,
    appLayer: Layer.mergeAll(
      factory,
      Layer.succeed(TokenServiceTag, fakeTokens),
      Layer.succeed(
        PolicyDecisionTag,
        makeStaticPolicyDecision({ reader: ['catalog:widget:read'] }),
      ),
    ),
  });
});

afterAll(async () => {
  await service.close();
});

beforeEach(() => {
  opened.length = 0;
  failure = undefined;
});

const call = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${service.baseUrl}${path}`, init);
  return { status: res.status, body: (await res.json()) as unknown };
};

describe('makeEntityFacetRoutes', () => {
  it('counts each facet under its own filtering', async () => {
    const { status, body } = await call(
      `/api/widget/$facets?facet=brand&facet=owner&${new URLSearchParams({
        'rsql.owner': 'brand==aurora',
      })}`,
    );

    expect(status).toBe(200);
    expect(body).toEqual({
      meta: { type: 'entityFacets', entity: 'widget' },
      data: {
        brand: [
          { value: 'aurora', count: 2 },
          { value: 'terra', count: 1 },
        ],
        owner: [
          { value: 'ada', count: 1 },
          { value: 'alan', count: 1 },
        ],
      },
    });
    expect(opened).toEqual([{}]);
  });

  it('answers a member that is not filterable with a 400', async () => {
    const { status, body } = await call('/api/widget/$facets?facet=note');

    expect(status).toBe(400);
    expect(body).toMatchObject({ code: 'invalidQuery' });
  });

  it('answers a counter it could not open with a 500', async () => {
    failure = new EntifixConnError('down');

    const { status } = await call('/api/widget/$facets?facet=brand');

    expect(status).toBe(500);
  });

  it('conjoins the caller’s scope into every facet, on the caller’s organization', async () => {
    const { body } = await call(
      `/api/tenant/widget/$facets?facet=brand&facet=owner&${new URLSearchParams(
        { 'rsql.owner': 'owner==alan' },
      )}`,
      { headers: as('ada') },
    );

    expect((body as { data: unknown }).data).toEqual({
      brand: [
        { value: 'aurora', count: 1 },
        { value: 'terra', count: 1 },
      ],
      // `owner==alan` and the scope's `owner==ada`: nothing, rather than
      // the query reaching past the scope.
      owner: [],
    });
    expect(opened).toEqual([{ organizationId: 'org-1' }]);
  });

  it('counts everything for a caller scoped to all', async () => {
    const { body } = await call('/api/tenant/widget/$facets?facet=owner', {
      headers: as('everyone'),
    });

    expect((body as { data: unknown }).data).toEqual({
      owner: [
        { value: 'ada', count: 2 },
        { value: 'alan', count: 1 },
      ],
    });
  });

  it('answers a caller who owns nothing with every facet empty, and opens no counter', async () => {
    const { status, body } = await call(
      '/api/tenant/widget/$facets?facet=brand',
      { headers: as('nobody') },
    );

    expect(status).toBe(200);
    expect((body as { data: unknown }).data).toEqual({ brand: [] });
    expect(opened).toEqual([]);
  });

  it('refuses a count with no session behind the organization guard', async () => {
    const { status } = await call('/api/tenant/widget/$facets?facet=brand');

    expect(status).toBe(401);
  });
});
