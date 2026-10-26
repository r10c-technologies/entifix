import type { Action } from '@entifix/authz';
import {
  deleteUCFactory,
  EntityIdTag,
  EntityLoadRequestTag,
  EntityRepositoryFactoryTag,
  EntityRepositoryTag,
  EntityTag,
  getUCFactory,
  loadUCFactory,
  saveUCFactory,
} from '@entifix/business';
import {
  EntifixBuildError,
  type EntifixEnvelopeLink,
  type Entity,
  type EntityConstructor,
  type EntityId,
  type EntityLoadRequest,
  envelopeEntityName,
  extractMetaEntity,
  makeEntityEnvelope,
  makeEntityPageEnvelope,
  parseLoadRequestParams,
  readEntityEnvelope,
} from '@entifix/core';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';

import { entityMetadataRoute } from './entity-metadata-route.js';
import {
  type EntityReadScope,
  type EntityRouteContext,
  type EntityRouteGuard,
  guardRoute,
  type GuardServices,
} from './entity-route-guard.js';
import {
  EntityRouteRefusal,
  invalid,
  routeFailure,
} from './route-responses.js';

/** The five generic verbs a route set can mount. */
export type EntityVerb = 'list' | 'get' | 'create' | 'update' | 'delete';

export {
  type EntityReadScope,
  type EntityRouteContext,
  type EntityRouteGuard,
} from './entity-route-guard.js';
export { EntityRouteRefusal } from './route-responses.js';

/** A hand-written handler for one verb, mounted under the derived guard. */
export type EntityRouteOverride<R> = (
  context: EntityRouteContext,
  links: EntityRouteLinks,
) => Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, R>;

/** The affordances a route set derives from the verbs it mounts. */
export interface EntityRouteLinks {
  readonly record: (id: EntityId) => EntifixEnvelopeLink[];
  readonly collection: () => EntifixEnvelopeLink[];
}

export interface EntityRoutesOptions<
  T extends Entity,
  R,
  G extends EntityRouteGuard = EntityRouteGuard,
> {
  readonly verbs: readonly EntityVerb[];
  /** One guard for every verb, or one for the reads and one for the writes. */
  readonly guard: G | { readonly read: G; readonly write: G };
  /** Defaults to `/api/<entity key>`. */
  readonly basePath?: `/${string}`;
  /** Narrows the reads to what this caller may see. */
  readonly scope?: (
    context: EntityRouteContext,
  ) => Effect.Effect<EntityReadScope<T>, never, R>;
  /**
   * Runs on every create and update, after the body is read and before the
   * save — and may change what is saved, or refuse it.
   */
  readonly prepare?: (
    entity: T,
    context: EntityRouteContext & { readonly verb: 'create' | 'update' },
  ) => Effect.Effect<T, EntityRouteRefusal | EntifixBuildError, R>;
  /**
   * A hand-written handler in place of the generic one for a verb. It keeps
   * the derived guard and receives the derived links, so the escape hatch
   * cannot drift from the rest of the set.
   */
  readonly override?: Partial<Record<EntityVerb, EntityRouteOverride<R>>>;
}

const ACTION: Record<EntityVerb, Action> = {
  list: 'read',
  get: 'read',
  create: 'write',
  update: 'write',
  delete: 'delete',
};

const READS: ReadonlySet<EntityVerb> = new Set(['list', 'get']);

/**
 * The generic routes for one entity — list, read, create, update, delete and
 * its `$metadata` — derived from the entity and bound to storage through the
 * host's {@link EntityRepositoryFactoryTag}.
 *
 * What a route set varies on is stated, not written: which verbs exist, who may
 * reach them, which records a reader sees, and what a save must pass. What it
 * never varies on is the wire: the load request is parsed against the entity's
 * own metadata (so a query can only name a member the entity declared
 * filterable or sortable), every answer is an envelope, and the links name
 * exactly the verbs mounted — never one that would `404`.
 *
 * A path that is not one of these verbs is written by hand beside it, and a
 * verb whose generic form does not fit is replaced with `override`.
 */
const deriveEntityRoutes = <
  T extends Entity,
  R = never,
  // `never`, not the whole union: TypeScript infers no type argument once a
  // caller names one, so `makeEntityRoutes<T, R>(…)` used to default `G` to
  // every guard. Then the crossing tags became requirements of a route that
  // guards on a session, and the error surfaced at the host's `Layer.provide`
  // instead of here. Defaulting to `never` refuses that call at the guard
  // itself; `makeEntityRoutes.for<R>()` is the way to name `R` alone.
  const G extends EntityRouteGuard = never,
>(
  entityConstructor: EntityConstructor<T>,
  options: EntityRoutesOptions<T, R, G>,
) => {
  const key = envelopeEntityName(entityConstructor);
  const base: `/${string}` = options.basePath ?? `/api/${key}`;
  const mounted = new Set(options.verbs);

  const links: EntityRouteLinks = {
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
      ];
    },
    collection: () => [
      ...(mounted.has('list')
        ? [{ rel: 'self', href: base, method: 'GET' } as const]
        : []),
      ...(mounted.has('create')
        ? [{ rel: 'create', href: base, method: 'POST' } as const]
        : []),
    ],
  };

  const guardFor = (verb: EntityVerb): EntityRouteGuard => {
    const guard = options.guard as
      | EntityRouteGuard
      | { readonly read: EntityRouteGuard; readonly write: EntityRouteGuard };
    return 'kind' in guard ? guard : READS.has(verb) ? guard.read : guard.write;
  };

  const guarded = <A, E, RR>(
    verb: EntityVerb,
    use: (context: EntityRouteContext) => Effect.Effect<A, E, RR>,
  ) => guardRoute(entityConstructor, guardFor(verb), ACTION[verb], use);

  const repository = (context: EntityRouteContext) =>
    Effect.gen(function* () {
      const factory = yield* EntityRepositoryFactoryTag;
      return yield* factory.for(entityConstructor, {
        ...(context.organizationId === undefined
          ? {}
          : { organizationId: context.organizationId }),
      });
    });

  const scopeOf = (context: EntityRouteContext) =>
    options.scope ? options.scope(context) : Effect.succeed('all' as const);

  const readLoadRequest = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const search = new URL(request.url, 'http://localhost').searchParams;
    return yield* Effect.try({
      try: () =>
        parseLoadRequestParams(
          entityConstructor,
          search,
        ) as unknown as EntityLoadRequest<T>,
      catch: error => error as EntifixBuildError,
    });
  });

  const notFound = HttpServerResponse.json(
    {
      message: 'not found',
      code: 'notFound',
      entity: extractMetaEntity(entityConstructor).key,
    },
    { status: 404 },
  );

  const list = (context: EntityRouteContext) =>
    Effect.gen(function* () {
      const parsed = yield* readLoadRequest;
      const scope = yield* scopeOf(context);
      if (scope === 'none') {
        // Still parsed: whether a query is well-formed must not depend on who
        // asked.
        return yield* HttpServerResponse.json(
          makeEntityPageEnvelope(
            entityConstructor,
            { items: [], total: 0, request: parsed },
            links.collection(),
          ),
        );
      }
      // Conjoined, never substituted: the translator `$and`s every top-level
      // element, so an added element can only narrow, and no `or` in a query
      // string can escape it.
      const request: EntityLoadRequest<T> =
        scope === 'all'
          ? parsed
          : {
              ...parsed,
              filtering: [...(parsed.filtering ?? []), scope.filter],
            };
      const page = yield* loadUCFactory<T>().pipe(
        Effect.provideService(EntityRepositoryTag, yield* repository(context)),
        Effect.provideService(
          EntityLoadRequestTag,
          request as unknown as EntityLoadRequest,
        ),
      );
      return yield* HttpServerResponse.json(
        makeEntityPageEnvelope(entityConstructor, page, links.collection()),
      );
    }).pipe(
      Effect.catch(error => invalid(error, 'invalid query', 'invalidQuery')),
    );

  const get = (context: EntityRouteContext) =>
    Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      const scope = yield* scopeOf(context);
      if (scope === 'none') return yield* notFound;
      const found = yield* getUCFactory<T>().pipe(
        Effect.provideService(EntityRepositoryTag, yield* repository(context)),
        Effect.provideService(EntityIdTag, params.id),
        Effect.option,
      );
      // Out of scope answers exactly as absent does: a `403` would confirm the
      // record exists to somebody who may not read it.
      if (
        found._tag === 'None' ||
        (scope !== 'all' && !scope.includes(found.value))
      ) {
        return yield* notFound;
      }
      return yield* HttpServerResponse.json(
        makeEntityEnvelope(
          entityConstructor,
          found.value,
          links.record(params.id),
        ),
      );
    }).pipe(Effect.catch(routeFailure));

  const save = (verb: 'create' | 'update') => (context: EntityRouteContext) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const body = yield* request.json;
      let entity = yield* readEntityEnvelope(entityConstructor, body);

      // On update the URL is authoritative, so a record cannot be renamed
      // onto another one by editing its payload.
      if (verb === 'update') {
        const params = yield* HttpRouter.params;
        entity.id = params.id;
      }
      if (options.prepare) {
        entity = yield* options.prepare(entity, { ...context, verb });
      }

      const saved = yield* saveUCFactory<T>().pipe(
        Effect.provideService(EntityRepositoryTag, yield* repository(context)),
        Effect.provideService(EntityTag, entity),
      );
      return yield* HttpServerResponse.json(
        makeEntityEnvelope(entityConstructor, saved, links.record(saved.id)),
      );
    }).pipe(
      Effect.catch(error =>
        invalid(error, 'invalid request body', 'invalidBody'),
      ),
    );

  /**
   * Answers with an envelope rather than a bare `204`: every message between
   * entifix artifacts is one, and the fetch client parses every response as
   * JSON.
   */
  const remove = (context: EntityRouteContext) =>
    Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      yield* deleteUCFactory<T>().pipe(
        Effect.provideService(EntityRepositoryTag, yield* repository(context)),
        Effect.provideService(EntityIdTag, params.id),
      );
      return yield* HttpServerResponse.json({
        meta: { type: 'entity', entity: key, links: links.collection() },
        data: { id: params.id },
      });
    }).pipe(Effect.catch(routeFailure));

  const generic = (verb: EntityVerb, context: EntityRouteContext) => {
    switch (verb) {
      case 'list':
        return list(context);
      case 'get':
        return get(context);
      case 'create':
        return save('create')(context);
      case 'update':
        return save('update')(context);
      case 'delete':
        return remove(context);
    }
  };

  /**
   * Each guard asks for different services, so the branches do not unify on
   * their own; the cast states the union every guard this set can reach
   * actually needs.
   */
  const handlerFor = (verb: EntityVerb) =>
    guarded(verb, context => {
      const override = options.override?.[verb];
      return override ? override(context, links) : generic(verb, context);
    }) as Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      unknown,
      | R
      | EntityRepositoryFactoryTag
      | GuardServices<G>
      | HttpServerRequest.HttpServerRequest
      | HttpRouter.RouteContext
    >;

  const ROUTES: Record<
    EntityVerb,
    { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: `/${string}` }
  > = {
    list: { method: 'GET', path: base },
    get: { method: 'GET', path: `${base}/:id` },
    create: { method: 'POST', path: base },
    update: { method: 'PUT', path: `${base}/:id` },
    delete: { method: 'DELETE', path: `${base}/:id` },
  };

  return HttpRouter.addAll([
    // A literal, so it wins over `/:id` regardless of order.
    HttpRouter.route(
      'GET',
      `${base}/$metadata`,
      entityMetadataRoute(entityConstructor),
    ),
    ...options.verbs.map(verb =>
      HttpRouter.route(
        ROUTES[verb].method,
        ROUTES[verb].path,
        handlerFor(verb),
      ),
    ),
  ]);
};

/**
 * {@link deriveEntityRoutes}, with a curried form for a caller that has to
 * name the services its `override`, `scope` or `prepare` handlers need:
 * `makeEntityRoutes.for<R>()(Entity, options)` names `R` and still infers the
 * entity and the guard from the value, which a single call with explicit type
 * arguments cannot do.
 */
export { routeFailure };

export const makeEntityRoutes = Object.assign(deriveEntityRoutes, {
  for:
    <R>() =>
    <T extends Entity, const G extends EntityRouteGuard>(
      entityConstructor: EntityConstructor<T>,
      options: EntityRoutesOptions<T, R, G>,
    ) =>
      deriveEntityRoutes<T, R, G>(entityConstructor, options),
});
