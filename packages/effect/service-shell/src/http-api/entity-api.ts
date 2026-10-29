import { createHash } from 'node:crypto';

import {
  type Action,
  parsePermission,
  type Permission,
  permissionForEntity,
  permissionForUseCase,
  PolicyDecisionTag,
} from '@entifix/authz';
import {
  deleteUCFactory,
  type EntityApiContext,
  type EntityApiDeclaration,
  type EntityApiGuard,
  type EntityApiLinks,
  type EntityApiOptions,
  type EntityApiRequest,
  type EntityApiVerb,
  EntityFacetCounterFactoryTag,
  EntityFacetCounterTag,
  EntityIdTag,
  EntityLoadRequestTag,
  EntityRepositoryFactoryTag,
  EntityRepositoryTag,
  EntityTag,
  facetCountsUCFactory,
  getUCFactory,
  loadUCFactory,
  type Narrowing,
  OrganizationIdTag,
  type RequestPrincipal,
  RequestPrincipalTag,
  saveUCFactory,
  type VerbEndpoint,
  VerifiedContextTag,
} from '@entifix/business';
import {
  type AnyEndpoint,
  defineEndpoint,
  describeEntityUseCases,
  type EndpointGuard,
  type Entity,
  ENTITY_ACTIONS,
  type EntityConstructor,
  type EntityFacetCounts,
  type EntityFacetQuery,
  type EntityLoadRequest,
  type EntityMetadataDocument,
  Envelope,
  implement,
  type Implemented,
  InvalidQuery,
  JsonBody,
  makeEntityEnvelope,
  makeEntityFacetsEnvelope,
  makeEntityMetadataEnvelope,
  makeEntityPageEnvelope,
  NotFound,
  parseFacetQueryParams,
  parseLoadRequestParams,
  readEntityEnvelope,
  verbPath,
} from '@entifix/core';
import { Effect, Option, Schema } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';

import { resolveRequestPrincipal } from '../auth/require-principal.js';
import {
  assertCompositionsDeclared,
  compositionFor,
  type MetadataCompositions,
} from '../metadata-composition.js';
import {
  narrowedByIdRequest,
  narrowingFor,
  narrowLoadRequest,
} from '../narrowing.js';
import type { EndpointGroup } from './build-api.js';

/** A collection verb's body: the selection, in its wire form. */
const SelectionBody = Schema.Struct({ selection: Schema.Unknown });

const ACTION: Record<EntityApiVerb, Action> = {
  list: 'read',
  get: 'read',
  create: 'write',
  update: 'write',
  delete: 'delete',
};

const READS: ReadonlySet<EntityApiVerb> = new Set(['list', 'get']);

const METHOD = {
  list: 'GET',
  get: 'GET',
  create: 'POST',
  update: 'PUT',
  delete: 'DELETE',
} as const;

/** Any envelope: the entity codec reads `data`, so the wire stays open. */
const EnvelopeBody = Envelope.codec(Schema.Unknown);

const endpointGuardFor = (
  guard: EntityApiGuard,
  permission: () => Permission,
): EndpointGuard => {
  switch (guard.kind) {
    case 'public':
      return { kind: 'public' };
    case 'crossing':
      return {
        kind: 'crossing',
        permission: permission(),
        organization: guard.organization,
      };
    default:
      return { kind: guard.kind, permission: permission() };
  }
};

const endpointGuard = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
  guard: EntityApiGuard,
  action: Action,
): EndpointGuard =>
  endpointGuardFor(guard, () => permissionForEntity(entityConstructor, action));

/** The request context a guard provided, read without requiring it. */
const callerContext = Effect.gen(function* () {
  const organizationId = yield* Effect.serviceOption(OrganizationIdTag);
  const principal = yield* Effect.serviceOption(RequestPrincipalTag);
  const verified = yield* Effect.serviceOption(VerifiedContextTag);
  return {
    ...Option.match(organizationId, {
      onNone: () => ({}),
      onSome: value => ({ organizationId: value }),
    }),
    ...Option.match(principal, {
      onNone: () => ({}),
      onSome: value => ({ principal: value }),
    }),
    ...Option.match(verified, {
      onNone: () => ({}),
      onSome: value => ({ verified: value }),
    }),
  };
});

/** The search the request carried, for the RSQL parsers. */
const searchParams = Effect.map(
  HttpServerRequest.HttpServerRequest,
  request => new URL(request.url, 'http://localhost').searchParams,
);

// The RSQL parsers throw a build error naming what they refused.
const asInvalidQuery = (error: unknown) =>
  new InvalidQuery({ reason: (error as Error).message });

const cacheHeaders = (etag: string) => ({
  etag,
  'cache-control': 'private, no-cache',
  vary: 'Cookie, Authorization',
});

/* eslint-disable @typescript-eslint/no-explicit-any -- type-level extraction */
type KindOf<G> = G extends { readonly kind: infer Kind }
  ? Kind
  : G extends { readonly read: infer Read; readonly write: infer Write }
    ? KindOf<Read> | KindOf<Write>
    : never;

type OverrideValues<O> = O extends { readonly override: infer Overrides }
  ? Overrides extends object
    ? NonNullable<Overrides[keyof Overrides]>
    : never
  : never;

// Distributive over the overrides, so a group with none contributes nothing.
type OverrideGuardKinds<V> = V extends { readonly guard: infer G }
  ? KindOf<G>
  : never;
type OverrideIdempotency<V> = V extends { readonly idempotent: infer I }
  ? I
  : never;

type UseCaseValues<O> = O extends { readonly useCases: infer U }
  ? U extends ReadonlyArray<infer V>
    ? V
    : never
  : never;

/** Every guard kind an entity group mounts: `$metadata` is a session. */
export type EntityGuardKinds<O> = Extract<
  | 'session'
  | KindOf<O extends { readonly guard: infer G } ? G : never>
  | OverrideGuardKinds<OverrideValues<O> | UseCaseValues<O>>,
  EndpointGuard['kind']
>;

/** Every idempotency mode an entity group's overrides and verbs declare. */
export type EntityIdempotencies<O> = OverrideIdempotency<
  OverrideValues<O> | UseCaseValues<O>
>;

type ReturnRequirements<F> = F extends (
  ...args: any[]
) => Effect.Effect<any, any, infer R>
  ? R
  : never;
type OverrideRequirements<V> = V extends { readonly handler: infer H }
  ? ReturnRequirements<H>
  : never;

/** What the host's `prepare` and overrides need. */
export type OptionsRequirements<O> =
  | ReturnRequirements<O extends { readonly prepare: infer P } ? P : never>
  | OverrideRequirements<OverrideValues<O> | UseCaseValues<O>>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** An entity endpoint as its guard kinds and idempotency type it. */
export type EntityEndpoint<
  Kind extends EndpointGuard['kind'],
  Idempotency,
> = AnyEndpoint & {
  readonly guard: Extract<EndpointGuard, { readonly kind: Kind }>;
  readonly idempotent?: Idempotency;
};

/** What the shell adds when it serves an entity's declared endpoints. */
export interface EntityApiServing {
  /** The compositions `$metadata` reports for the entity's verbs. */
  readonly compositions?: MetadataCompositions;
}

/**
 * The generic endpoints of an entity — list, get, create, update, delete,
 * `$metadata` and, when asked, `$facets` — as one group named for its key
 * ([ADR 0020](../../../../../docs/adr/0020-endpoints-are-descriptors-and-the-shell-builds-an-httpapi.md)).
 *
 * `$metadata` and `$facets` come before `/:id`, so neither is read as an id.
 * The list query is the entity's RSQL request, parsed against its own
 * `filterable`/`sortable` metadata: a member that is not queryable answers
 * `invalidQuery`. A narrowing is conjoined onto every read and count, never
 * substituted, and a reader it leaves with nothing gets an empty page and a
 * `404`, never a `403`.
 *
 * It serves a declaration the domain made with `defineEntityApi`; what the
 * shell alone knows — the recipes and variants `$metadata` resolves verbs
 * against — is added here.
 */
export const entityApi = <
  T extends Entity,
  const K extends string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inferred from the options
  const O extends EntityApiOptions<T, any>,
>(
  declaration: EntityApiDeclaration<T, K, O>,
  serving: EntityApiServing = {},
): EndpointGroup<
  EntityEndpoint<EntityGuardKinds<O>, EntityIdempotencies<O>>,
  | OptionsRequirements<O>
  | EntityRepositoryFactoryTag
  | PolicyDecisionTag
  | (O['facets'] extends true ? EntityFacetCounterFactoryTag : never)
> => {
  const { entity: entityConstructor, key, options } = declaration;
  const base = `/api/${key}` as const;
  const record = `${base}/:id` as const;
  const mounted = new Set(options.verbs);
  const notFound = new NotFound({ entity: key });

  const compositions = serving.compositions ?? {};
  assertCompositionsDeclared(
    describeEntityUseCases(entityConstructor),
    compositions,
  );

  const verbs = options.useCases ?? [];
  const declaredVerbs = describeEntityUseCases(entityConstructor).map(
    descriptor => descriptor.key,
  );
  const servedVerbs = verbs.map(verb => verb.useCase.key);
  const unserved = declaredVerbs.filter(verb => !servedVerbs.includes(verb));
  const strays = verbs.filter(
    verb => verb.useCase.entity !== entityConstructor,
  );
  if (unserved.length > 0 || strays.length > 0)
    throw new Error(
      `the '${key}' endpoints ` +
        [
          ...(unserved.length > 0
            ? [
                `serve no endpoint for @useCase() ${unserved.map(v => `'${v}'`).join(', ')}`,
              ]
            : []),
          ...(strays.length > 0
            ? [
                `serve ${strays.map(v => `'${v.useCase.key}'`).join(', ')}, declared on another entity`,
              ]
            : []),
        ].join(', and ') +
        '; a verb has exactly one endpoint, on its own entity.',
    );

  const linksFor = (allowed: ReadonlySet<string>): EntityApiLinks => ({
    record: id => {
      const href = `${base}/${String(id)}`;
      return [
        ...(mounted.has('get')
          ? [{ rel: 'self', href, method: 'GET' } as const]
          : []),
        ...(mounted.has('list')
          ? [{ rel: 'list', href: base, method: 'GET' } as const]
          : []),
        ...(mounted.has('update')
          ? [{ rel: 'update', href, method: 'PUT' } as const]
          : []),
        ...(mounted.has('delete')
          ? [{ rel: 'delete', href, method: 'DELETE' } as const]
          : []),
        ...verbs
          .filter(
            verb =>
              verb.useCase.binding === 'entity' &&
              allowed.has(verb.useCase.key),
          )
          .map(
            verb =>
              ({
                rel: verb.useCase.key,
                href: `${href}/${verb.useCase.key}`,
                method: 'POST',
              }) as const,
          ),
      ];
    },
    collection: () => [
      ...(mounted.has('list')
        ? [{ rel: 'self', href: base, method: 'GET' } as const]
        : []),
      ...(mounted.has('create')
        ? [{ rel: 'create', href: base, method: 'POST' } as const]
        : []),
      ...verbs
        .filter(
          verb =>
            verb.useCase.binding !== 'entity' && allowed.has(verb.useCase.key),
        )
        .map(
          verb =>
            ({
              rel: verb.useCase.key,
              href: `${base}/${verb.useCase.key}`,
              method: 'POST',
            }) as const,
        ),
    ],
  });

  const guardFor = (verb: EntityApiVerb): EntityApiGuard => {
    const declared = options.override?.[verb]?.guard;
    if (declared !== undefined) return declared;
    const { guard } = options;
    return 'kind' in guard ? guard : READS.has(verb) ? guard.read : guard.write;
  };

  const verbGuard = (verb: VerbEndpoint<unknown>): EntityApiGuard =>
    verb.guard ?? guardFor('create');

  /**
   * The verbs this caller would be let through: a public verb for anybody, a
   * session verb for a principal the policy permits. A crossing verb is never
   * linked — no browser holds the token that reaches it.
   */
  const allowedVerbs = (principal: RequestPrincipal | undefined) =>
    Effect.gen(function* () {
      const policy = yield* PolicyDecisionTag;
      const allowed = new Set<string>();
      for (const verb of verbs) {
        const kind = verbGuard(verb).kind;
        if (kind === 'public') allowed.add(verb.useCase.key);
        else if (kind !== 'crossing' && principal !== undefined) {
          const { resource, action } = parsePermission(
            permissionForUseCase(entityConstructor, verb.useCase.key),
          );
          if (
            policy.decide({
              subject: { roles: principal.roles },
              resource,
              action,
            })
          )
            allowed.add(verb.useCase.key);
        }
      }
      return allowed;
    });

  const context = Effect.gen(function* () {
    const caller = yield* callerContext;
    // A public read verifies no session, but a signed-in caller reading it
    // still sees the verbs they may run: the links read the session, if any,
    // and never decide anything by it.
    const principal =
      caller.principal ?? Option.getOrUndefined(yield* resolveRequestPrincipal);
    const allowed = yield* allowedVerbs(principal);
    return { ...caller, links: linksFor(allowed) } as EntityApiContext;
  });

  const repository = (caller: EntityApiContext) =>
    Effect.flatMap(EntityRepositoryFactoryTag, factory =>
      factory.for(entityConstructor, {
        ...(caller.organizationId === undefined
          ? {}
          : { organizationId: caller.organizationId }),
      }),
    );

  const narrowingOf = (caller: EntityApiContext): Narrowing<T> | undefined =>
    options.narrowing === undefined || caller.verified === undefined
      ? undefined
      : narrowingFor(options.narrowing, caller.verified);

  const list = Effect.gen(function* () {
    const caller = yield* context;
    const search = yield* searchParams;
    const parsed = yield* Effect.try({
      try: () =>
        parseLoadRequestParams(
          entityConstructor,
          search,
        ) as unknown as EntityLoadRequest<T>,
      catch: asInvalidQuery,
    });
    const narrowing = narrowingOf(caller);
    // Still parsed: whether a query is well-formed must not depend on who
    // asked. `nothing` answers here without a query.
    if (narrowing === 'nothing')
      return makeEntityPageEnvelope(
        entityConstructor,
        { items: [], total: 0, request: parsed },
        caller.links.collection(),
      );
    const request =
      narrowing === undefined || narrowing === 'unscoped'
        ? parsed
        : narrowLoadRequest(parsed, narrowing);
    const page = yield* loadUCFactory<T>().pipe(
      Effect.provideService(EntityRepositoryTag, yield* repository(caller)),
      Effect.provideService(
        EntityLoadRequestTag,
        request as unknown as EntityLoadRequest,
      ),
    );
    return makeEntityPageEnvelope(
      entityConstructor,
      page,
      caller.links.collection(),
    );
  });

  const get = (id: string) =>
    Effect.gen(function* () {
      const caller = yield* context;
      const narrowing = narrowingOf(caller);
      if (narrowing === 'nothing') return yield* Effect.fail(notFound);
      // A filter narrowing reads by id as a narrowed load, so the read and the
      // list apply one rule.
      if (narrowing !== undefined && narrowing !== 'unscoped') {
        const page = yield* loadUCFactory<T>().pipe(
          Effect.provideService(EntityRepositoryTag, yield* repository(caller)),
          Effect.provideService(
            EntityLoadRequestTag,
            narrowedByIdRequest<T>(
              narrowing,
              id,
            ) as unknown as EntityLoadRequest,
          ),
        );
        const [only] = page.items;
        if (only === undefined) return yield* Effect.fail(notFound);
        return makeEntityEnvelope(
          entityConstructor,
          only,
          caller.links.record(id),
        );
      }
      const found = yield* getUCFactory<T>().pipe(
        Effect.provideService(EntityRepositoryTag, yield* repository(caller)),
        Effect.provideService(EntityIdTag, id),
      );
      return makeEntityEnvelope(
        entityConstructor,
        found,
        caller.links.record(id),
      );
    });

  const save = (verb: 'create' | 'update', body: unknown, id?: string) =>
    Effect.gen(function* () {
      const caller = yield* context;
      let entity = yield* readEntityEnvelope(entityConstructor, body);
      // On update the path is authoritative, so a record cannot be renamed
      // onto another one by editing its payload.
      if (id !== undefined) entity.id = id;
      if (options.prepare !== undefined)
        entity = yield* options.prepare(entity, { ...caller, verb });
      const saved = yield* saveUCFactory<T>().pipe(
        Effect.provideService(EntityRepositoryTag, yield* repository(caller)),
        Effect.provideService(EntityTag, entity),
      );
      return makeEntityEnvelope(
        entityConstructor,
        saved,
        caller.links.record(saved.id),
      );
    });

  const remove = (id: string) =>
    Effect.gen(function* () {
      const caller = yield* context;
      yield* deleteUCFactory<T>().pipe(
        Effect.provideService(EntityRepositoryTag, yield* repository(caller)),
        Effect.provideService(EntityIdTag, id),
      );
      // An envelope rather than a bare `204`: every message between entifix
      // artifacts is one.
      return {
        meta: { type: 'entity', entity: key, links: caller.links.collection() },
        data: { id },
      };
    });

  const metadata = Effect.gen(function* () {
    const principal = yield* RequestPrincipalTag;
    const verified = yield* VerifiedContextTag;
    const policy = yield* PolicyDecisionTag;
    const allows = (permission: Permission): boolean => {
      const { resource, action } = parsePermission(permission);
      return policy.decide({
        subject: { roles: principal.roles },
        resource,
        action,
      });
    };
    // SECURITY BOUNDARY. The document is a map of the model, so an entity the
    // caller may not read answers exactly as one this service does not host:
    // a `403` would make the endpoint an oracle.
    if (!allows(permissionForEntity(entityConstructor, 'read')))
      return yield* Effect.fail(notFound);

    const document: EntityMetadataDocument = {
      actions: ENTITY_ACTIONS.filter(action =>
        allows(permissionForEntity(entityConstructor, action)),
      ),
      useCases: describeEntityUseCases(entityConstructor)
        .filter(descriptor =>
          allows(permissionForUseCase(entityConstructor, descriptor.key)),
        )
        // A verb the caller resolves to nothing is omitted, like one they may
        // not invoke; the rest carry what they resolve to.
        .flatMap(descriptor => {
          const composition = compositionFor(
            descriptor,
            verified,
            compositions,
          );
          if (composition === 'unreachable') return [];
          return composition === undefined
            ? [descriptor]
            : [{ ...descriptor, composition }];
        }),
    };

    // The ETag hashes the computed document, not the model: two principals
    // with different grants get different documents from one model.
    const body = JSON.stringify(
      makeEntityMetadataEnvelope(entityConstructor, document),
    );
    const etag = `"${createHash('sha256').update(body).digest('hex')}"`;
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.headers['if-none-match'] === etag)
      return HttpServerResponse.empty({ status: 304 }).pipe(
        HttpServerResponse.setHeaders(cacheHeaders(etag)),
      );
    return HttpServerResponse.text(body, {
      contentType: 'application/json',
      headers: cacheHeaders(etag),
    });
  });

  const facets = Effect.gen(function* () {
    const caller = yield* context;
    const search = yield* searchParams;
    const queries = yield* Effect.try({
      try: () => parseFacetQueryParams(entityConstructor, search),
      catch: asInvalidQuery,
    });
    const narrowing = narrowingOf(caller) ?? 'unscoped';
    if (narrowing === 'nothing') {
      const empty: EntityFacetCounts = Object.fromEntries(
        queries.map(({ member }) => [member, []]),
      );
      return makeEntityFacetsEnvelope(entityConstructor, empty);
    }
    const narrowed: EntityFacetQuery<T>[] =
      narrowing === 'unscoped'
        ? queries
        : queries.map(query => ({
            ...query,
            filtering: [...(query.filtering ?? []), narrowing],
          }));
    const factory = yield* EntityFacetCounterFactoryTag;
    const counter = yield* factory.for(entityConstructor, {
      ...(caller.organizationId === undefined
        ? {}
        : { organizationId: caller.organizationId }),
    });
    const counts = yield* facetCountsUCFactory<T>(narrowed).pipe(
      Effect.provideService(EntityFacetCounterTag, counter),
    );
    return makeEntityFacetsEnvelope(entityConstructor, counts);
  });

  const crudEndpoint = (verb: EntityApiVerb): Implemented => {
    const override = options.override?.[verb];
    const withId = verb !== 'list' && verb !== 'create';
    const takesBody = verb === 'create' || verb === 'update';
    const payload = takesBody
      ? (override?.payload ?? EnvelopeBody)
      : override?.payload;
    const descriptor = defineEndpoint({
      name: verb,
      method: METHOD[verb],
      path: withId ? record : base,
      ...(withId ? { params: { id: Schema.String } } : {}),
      ...(payload === undefined ? {} : { payload }),
      success: JsonBody,
      errors: [
        ...(verb === 'get' || verb === 'update' || verb === 'delete'
          ? [NotFound]
          : []),
        ...(verb === 'list' ? [InvalidQuery] : []),
        ...(takesBody ? (options.errors ?? []) : []),
        ...(override?.errors ?? []),
      ],
      guard: endpointGuard(entityConstructor, guardFor(verb), ACTION[verb]),
      ...(override?.idempotent === undefined
        ? {}
        : { idempotent: override.idempotent }),
    } as AnyEndpoint);

    return implement(descriptor, ((request: EntityApiRequest) => {
      if (override !== undefined)
        return Effect.flatMap(context, caller =>
          override.handler(request, caller),
        );
      const id = request.params?.id as string;
      switch (verb) {
        case 'list':
          return list;
        case 'get':
          return get(id);
        case 'create':
          return save('create', request.payload);
        case 'update':
          return save('update', request.payload, id);
        case 'delete':
          return remove(id);
      }
    }) as never) as Implemented;
  };

  const readGuard = guardFor('list');
  const endpoints: Implemented[] = [
    // Registered first, so neither is captured by `/:id`.
    implement(
      defineEndpoint({
        name: 'metadata',
        method: 'GET',
        path: `${base}/$metadata`,
        success: JsonBody,
        errors: [NotFound],
        guard: { kind: 'session' },
      }) as AnyEndpoint,
      (() => metadata) as never,
    ),
    ...(options.facets === true
      ? [
          implement(
            defineEndpoint({
              name: 'facets',
              method: 'GET',
              path: `${base}/$facets`,
              success: JsonBody,
              errors: [InvalidQuery],
              guard: endpointGuard(entityConstructor, readGuard, 'read'),
            }) as AnyEndpoint,
            (() => facets) as never,
          ),
        ]
      : []),
    ...options.verbs.map(crudEndpoint),
    ...verbs.map(verb => {
      const { useCase } = verb;
      const payload =
        useCase.payload ??
        (useCase.binding === 'collection' ? SelectionBody : undefined);
      const descriptor = defineEndpoint({
        name: useCase.key,
        method: 'POST',
        path: verbPath(key, useCase.key, useCase.binding),
        ...(useCase.binding === 'entity'
          ? { params: { id: Schema.String } }
          : {}),
        ...(payload === undefined ? {} : { payload }),
        success: useCase.success ?? JsonBody,
        errors: [...(useCase.errors ?? [])],
        guard: endpointGuardFor(verbGuard(verb), () =>
          permissionForUseCase(entityConstructor, useCase.key),
        ),
        useCase: useCase.key,
        ...(verb.idempotent === undefined
          ? {}
          : { idempotent: verb.idempotent }),
      } as AnyEndpoint);
      return implement(descriptor, ((request: EntityApiRequest) =>
        Effect.flatMap(context, caller =>
          verb.handler(request, caller),
        )) as never) as Implemented;
    }),
  ];

  return { name: key, endpoints } as never;
};
