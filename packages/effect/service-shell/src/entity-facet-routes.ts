import {
  EntityFacetCounterFactoryTag,
  EntityFacetCounterTag,
  facetCountsUCFactory,
} from '@entifix/business';
import {
  EntifixBuildError,
  type Entity,
  type EntityConstructor,
  type EntityFacetCounts,
  type EntityFacetQuery,
  envelopeEntityName,
  makeEntityFacetsEnvelope,
  parseFacetQueryParams,
} from '@entifix/core';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';

import {
  type EntityReadScope,
  type EntityRouteContext,
  type EntityRouteGuard,
  guardRoute,
  type GuardServices,
} from './entity-route-guard.js';
import { invalid } from './route-responses.js';

export interface EntityFacetRoutesOptions<
  T extends Entity,
  R,
  G extends EntityRouteGuard = EntityRouteGuard,
> {
  /** Who may count: the guard the entity's `list` has, as a rule. */
  readonly guard: G;
  /** Defaults to `/api/<entity key>`; the route is `<basePath>/$facets`. */
  readonly basePath?: `/${string}`;
  /**
   * Narrows the counts to the records this caller may see — the same scope
   * the entity's `list` takes, so a count never reveals a record the list
   * would not.
   */
  readonly scope?: (
    context: EntityRouteContext,
  ) => Effect.Effect<EntityReadScope<T>, never, R>;
}

/**
 * `GET <base>/$facets` — how many of the entity's records hold each value of
 * each `facet` member, each under its own `rsql.<member>` filtering — bound to
 * storage through the host's {@link EntityFacetCounterFactoryTag}.
 *
 * A route of its own beside `makeEntityRoutes` rather than a sixth verb, so it
 * is the one route set that requires a counter: a host that mounts it without
 * binding one fails to compile, and a host that never counts binds nothing.
 *
 * The query is parsed against the entity's metadata, so only a `filterable`
 * member is counted and every malformed request is a `400`. A scope is
 * **conjoined into every facet's filtering**, never substituted, so no query
 * string can count past it; `'none'` answers every member empty.
 */
export const makeEntityFacetRoutes = <
  T extends Entity,
  R = never,
  // `never` for the reason `makeEntityRoutes` gives: a caller naming `R`
  // explicitly must not widen the guard to every kind there is.
  const G extends EntityRouteGuard = never,
>(
  entityConstructor: EntityConstructor<T>,
  options: EntityFacetRoutesOptions<T, R, G>,
) => {
  const base: `/${string}` =
    options.basePath ?? `/api/${envelopeEntityName(entityConstructor)}`;

  const readQueries = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const search = new URL(request.url, 'http://localhost').searchParams;
    return yield* Effect.try({
      try: () => parseFacetQueryParams(entityConstructor, search),
      catch: error => error as EntifixBuildError,
    });
  });

  const scoped = (
    queries: EntityFacetQuery<T>[],
    scope: EntityReadScope<T>,
  ): EntityFacetQuery<T>[] =>
    scope === 'all' || scope === 'none'
      ? queries
      : queries.map(query => ({
          ...query,
          filtering: [...(query.filtering ?? []), scope.filter],
        }));

  const count = (context: EntityRouteContext) =>
    Effect.gen(function* () {
      const queries = yield* readQueries;
      const scope = options.scope
        ? yield* options.scope(context)
        : ('all' as const);
      if (scope === 'none') {
        // Still parsed: whether a query is well-formed must not depend on who
        // asked.
        const empty: EntityFacetCounts = Object.fromEntries(
          queries.map(({ member }) => [member, []]),
        );
        return yield* HttpServerResponse.json(
          makeEntityFacetsEnvelope(entityConstructor, empty),
        );
      }
      const factory = yield* EntityFacetCounterFactoryTag;
      const counter = yield* factory.for(entityConstructor, {
        ...(context.organizationId === undefined
          ? {}
          : { organizationId: context.organizationId }),
      });
      const counts = yield* facetCountsUCFactory<T>(
        scoped(queries, scope),
      ).pipe(Effect.provideService(EntityFacetCounterTag, counter));
      return yield* HttpServerResponse.json(
        makeEntityFacetsEnvelope(entityConstructor, counts),
      );
    }).pipe(
      Effect.catch(error => invalid(error, 'invalid query', 'invalidQuery')),
    );

  const handler = guardRoute(
    entityConstructor,
    options.guard,
    'read',
    count,
  ) as Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    unknown,
    | R
    | EntityFacetCounterFactoryTag
    | GuardServices<G>
    | HttpServerRequest.HttpServerRequest
    | HttpRouter.RouteContext
  >;

  return HttpRouter.addAll([
    HttpRouter.route('GET', `${base}/$facets`, handler),
  ]);
};
