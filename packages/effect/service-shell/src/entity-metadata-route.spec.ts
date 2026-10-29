import { makeStaticPolicyDecision, PolicyDecisionTag } from '@entifix/authz';
import {
  InvalidToken,
  Otherwise,
  type TokenClaims,
  TokenServiceTag,
  When,
} from '@entifix/business';
import type { Recipe } from '@entifix/business/compose';
import {
  defineCatalog,
  defineFragment,
  flowCommit,
} from '@entifix/business/flow';
import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  useCase,
} from '@entifix/core';
import { Effect, Layer, Schema } from 'effect';
import { HttpRouter } from 'effect/http';

import { entityMetadataRoute } from './entity-metadata-route.js';
import { serveTestService } from './serve-test-service.js';

/**
 * Declared locally rather than imported: framework code may not reach a host's
 * own domain package. The `domain`/`key` pair is what matters —
 * it is what the real `ROLE_PERMISSIONS` grants against, so the spec exercises
 * the shipped grant table rather than a stub of it.
 */
@entity({ domain: 'authn', key: 'user-identity' })
class UserIdentity implements Entity {
  #id?: EntityId;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

@useCase({
  entity: UserIdentity,
  key: 'update-aspects',
  binding: 'entity',
  placement: 'determining',
  labelKey: 'entity:user-identity.useCases.updateAspects',
})
class UpdateUserAspectsUC {
  static run() {
    return undefined;
  }
}

@useCase({
  entity: UserIdentity,
  key: 'revoke-sessions',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:user-identity.useCases.revokeSessions',
  confirm: {
    tone: 'destructive',
    messageKey: 'entity:user-identity.useCases.revokeSessionsConfirm',
  },
})
class RevokeUserSessionsUC {
  static run() {
    return undefined;
  }
}

/** An entity whose verbs resolve to variants and to a flow. */
@entity({ domain: 'sales', key: 'channel' })
class Channel implements Entity {
  #id?: EntityId;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

@useCase({
  entity: Channel,
  key: 'sell',
  binding: 'entity',
  placement: 'determining',
  labelKey: 'entity:channel.useCases.sell',
  variants: 'sell',
  recipe: 'checkout',
})
class SellUC {
  static run() {
    return undefined;
  }
}

@useCase({
  entity: Channel,
  key: 'audit',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:channel.useCases.audit',
  variants: 'audit',
})
class AuditUC {
  static run() {
    return undefined;
  }
}

const reserve = defineFragment({
  id: 'stock.reserve',
  version: 1,
  module: 'stock',
  kind: 'compensatable',
  participant: 'stock',
  call: { method: 'POST', path: '/api/reservation' },
  compensation: { method: 'DELETE', path: '/api/reservation/:id' },
  cardinality: 'perLine',
  requires: { entitlements: ['stock-management'] },
  contract: {
    input: Schema.Unknown,
    output: Schema.Unknown,
    failure: Schema.Unknown,
  },
});

const checkout: Recipe<unknown> = {
  name: 'checkout',
  input: Schema.Unknown,
  stages: [
    { name: 'hold', steps: [{ ref: 'stock.reserve@1' }] },
    { name: 'commit', steps: [{ ref: 'flow.commit@1' }] },
  ],
};

const compositions = {
  variants: {
    sell: [
      When(context => context.entitlements.includes('sales-management')).use({
        name: 'counter',
        impl: undefined,
      }),
    ],
    audit: [Otherwise.use({ name: 'plain', impl: undefined })],
  },
  recipes: { checkout },
  catalog: defineCatalog([reserve, flowCommit]),
};

/** An entity nobody is granted anything on — the "not readable" case. */
@entity({ domain: 'authn', key: 'secret-ledger' })
class SecretLedger implements Entity {
  #id?: EntityId;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

const fakeTokens = TokenServiceTag.of({
  sign: claims => Effect.succeed(JSON.stringify(claims)),
  verify: token =>
    Effect.try({
      try: () => JSON.parse(token) as TokenClaims,
      catch: () => new InvalidToken(),
    }),
});

const bearerFor = (
  roles: readonly string[],
  entitlements?: readonly string[],
) => ({
  Authorization: `Bearer ${JSON.stringify({
    userId: 'user-1',
    subject: 'user-1',
    sessionId: 'session-1',
    roles,
    ...(entitlements === undefined ? {} : { entitlements }),
  } satisfies TokenClaims)}`,
});

const router = HttpRouter.addAll([
  HttpRouter.route(
    'GET',
    '/api/user-identity/$metadata',
    entityMetadataRoute(UserIdentity),
  ),
  HttpRouter.route(
    'GET',
    '/api/channel/$metadata',
    entityMetadataRoute(Channel, compositions),
  ),
  // The regression test for the wildcard trap: a by-id route registered FIRST,
  // so the literal has to win on specificity rather than on ordering.
  HttpRouter.route(
    'GET',
    '/api/secret-ledger/:id',
    entityMetadataRoute(SecretLedger),
  ),
  HttpRouter.route(
    'GET',
    '/api/secret-ledger/$metadata',
    entityMetadataRoute(SecretLedger),
  ),
]);

/**
 * The grant table this spec authorizes against.
 *
 * ⚠️ **The shell's own, not an application's.** These specs used to authorize
 * through a host's grant table, which is exactly the coupling a framework must
 * not have: a shell is supposed to take a grant table, so its tests supply one.
 */
const GRANTS = {
  // Read and write but deliberately not delete, so "and no more" has something
  // to be true about; and a wildcard role for the triple.
  admin: [
    'authn:user-identity:read',
    'authn:user-identity:write',
    'authn:user-identity:update-aspects',
    'authn:user-identity:revoke-sessions',
  ],
  user: [],
  seller: ['sales:channel:read', 'sales:channel:sell', 'sales:channel:audit'],
  'super-admin': ['*:*:*'],
} as const;

const definition = {
  name: 'spec-metadata-service',
  port: 0,
  slices: ['test'],
  router,
  appLayer: Layer.mergeAll(
    Layer.succeed(TokenServiceTag, fakeTokens),
    Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision(GRANTS)),
  ),
};

/** The envelope shape these assertions read, so `res.json()` is not `unknown`. */
interface MetadataBody {
  meta: { type: string; entity: string };
  data: {
    actions: string[];
    useCases: Array<{
      key: string;
      confirm?: { tone: string; messageKey: string };
      composition?: Record<string, unknown>;
    }>;
  };
}

const readBody = async (res: Response): Promise<MetadataBody> =>
  (await res.json()) as MetadataBody;

const withService = async (
  use: (baseUrl: string) => Promise<void>,
): Promise<void> => {
  const service = await serveTestService(definition);
  try {
    await use(service.baseUrl);
  } finally {
    await service.close();
  }
};

describe('entityMetadataRoute, reporting what a verb resolves to', () => {
  const fetchAs = (baseUrl: string, entitlements: readonly string[]) =>
    fetch(`${baseUrl}/api/channel/$metadata`, {
      headers: bearerFor(['seller'], entitlements),
    });

  it('reports the variant and the recipe a verb resolves to for this caller', async () => {
    await withService(async baseUrl => {
      const body = await readBody(
        await fetchAs(baseUrl, ['sales-management', 'stock-management']),
      );

      expect(
        body.data.useCases.find(u => u.key === 'sell')?.composition,
      ).toEqual({
        useCase: 'sell',
        variant: 'counter',
        recipe: 'checkout',
        slipVersion: 1,
        fragments: ['stock.reserve@1', 'flow.commit@1'],
      });
      expect(
        body.data.useCases.find(u => u.key === 'audit')?.composition,
      ).toEqual({
        useCase: 'audit',
        variant: 'plain',
      });
    });
  });

  // An organization not provisioned for stock is offered no checkout at all.
  it('omits a verb whose recipe needs an entitlement the caller lacks', async () => {
    await withService(async baseUrl => {
      const body = await readBody(await fetchAs(baseUrl, ['sales-management']));

      expect(body.data.useCases.map(u => u.key)).toEqual(['audit']);
    });
  });

  it('omits a verb whose variants resolve to nothing', async () => {
    await withService(async baseUrl => {
      const body = await readBody(await fetchAs(baseUrl, ['stock-management']));

      expect(body.data.useCases.map(u => u.key)).toEqual(['audit']);
    });
  });

  it('gives two principals differing only in an entitlement different ETags', async () => {
    await withService(async baseUrl => {
      const entitled = await fetchAs(baseUrl, [
        'sales-management',
        'stock-management',
      ]);
      const not = await fetchAs(baseUrl, ['sales-management']);

      expect(entitled.headers.get('etag')).not.toBe(not.headers.get('etag'));
    });
  });

  it('refuses to mount when a verb names a variant set or recipe it was not given', () => {
    expect(() => entityMetadataRoute(Channel)).toThrow(
      "$metadata cannot resolve variants 'sell' (sell), recipe 'checkout' (sell), variants 'audit' (audit)",
    );
  });
});

describe('entityMetadataRoute', () => {
  it('refuses an anonymous request', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/user-identity/$metadata`);

      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({
        code: 'unauthenticated',
      });
    });
  });

  it('answers 404 — not 403 — to a caller who may not read the entity', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/user-identity/$metadata`, {
        headers: bearerFor(['user']),
      });

      // Indistinguishable from an entity this service does not host, so the
      // endpoint cannot be walked to enumerate the model.
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        code: 'notFound',
        entity: 'user-identity',
      });
    });
  });

  it('serves the actions and verbs an admin holds, and no more', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/user-identity/$metadata`, {
        headers: bearerFor(['admin']),
      });

      expect(res.status).toBe(200);
      const body = await readBody(res);
      expect(body.meta).toEqual({
        type: 'entityMetadata',
        entity: 'user-identity',
      });
      // `admin` holds read + write on this entity but not delete.
      expect(body.data.actions).toEqual(['read', 'write']);
      expect(body.data.useCases.map(d => d.key)).toEqual([
        'update-aspects',
        'revoke-sessions',
      ]);
      expect(body.data.useCases[1].confirm).toEqual({
        tone: 'destructive',
        messageKey: 'entity:user-identity.useCases.revokeSessionsConfirm',
      });
      expect(UpdateUserAspectsUC.run()).toBeUndefined();
      expect(RevokeUserSessionsUC.run()).toBeUndefined();
      expect(SellUC.run()).toBeUndefined();
      expect(AuditUC.run()).toBeUndefined();
    });
  });

  it('serves the whole triple to a wildcard grant', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/user-identity/$metadata`, {
        headers: bearerFor(['super-admin']),
      });

      expect(res.status).toBe(200);
      const body = await readBody(res);
      expect(body.data.actions).toEqual(['read', 'write', 'delete']);
      expect(body.data.useCases).toHaveLength(2);
    });
  });

  it('marks the response private and varies on both credential carriers', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/user-identity/$metadata`, {
        headers: bearerFor(['admin']),
      });

      expect(res.headers.get('cache-control')).toBe('private, no-cache');
      expect(res.headers.get('vary')).toBe('Cookie, Authorization');
      expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/);
    });
  });

  it('answers 304 to a matching If-None-Match', async () => {
    await withService(async baseUrl => {
      const first = await fetch(`${baseUrl}/api/user-identity/$metadata`, {
        headers: bearerFor(['admin']),
      });
      const etag = first.headers.get('etag') ?? '';

      const second = await fetch(`${baseUrl}/api/user-identity/$metadata`, {
        headers: { ...bearerFor(['admin']), 'If-None-Match': etag },
      });

      expect(second.status).toBe(304);
      expect(second.headers.get('etag')).toBe(etag);
    });
  });

  it('gives two principals different documents, and different ETags', async () => {
    await withService(async baseUrl => {
      const asAdmin = await fetch(`${baseUrl}/api/user-identity/$metadata`, {
        headers: bearerFor(['admin']),
      });
      const asSuperAdmin = await fetch(
        `${baseUrl}/api/user-identity/$metadata`,
        { headers: bearerFor(['super-admin']) },
      );

      expect(asAdmin.headers.get('etag')).not.toBe(
        asSuperAdmin.headers.get('etag'),
      );

      // The half that matters: an admin's ETag must not revalidate a
      // super-admin's document, or one caller is served the other's affordances.
      const crossed = await fetch(`${baseUrl}/api/user-identity/$metadata`, {
        headers: {
          ...bearerFor(['super-admin']),
          'If-None-Match': asAdmin.headers.get('etag') ?? '',
        },
      });
      expect(crossed.status).toBe(200);
    });
  });

  it('is reached at its literal path even where a /:id route is registered first', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/secret-ledger/$metadata`, {
        headers: bearerFor(['super-admin']),
      });

      expect(res.status).toBe(200);
      expect((await readBody(res)).meta.entity).toBe('secret-ledger');
    });
  });
});
