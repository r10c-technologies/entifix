import {
  type PolicyDecisionTag,
  ServiceCrossingPolicyTag,
} from '@entifix/authz';
import {
  IdempotencyKeyTag,
  IdempotencyStoreTag,
  OrganizationIdTag,
  type RequestPrincipal,
  RequestPrincipalTag,
  type TokenServiceTag,
} from '@entifix/business';
import {
  ACCESS_COOKIE,
  type EndpointGuard,
  type EndpointGuardKind,
  type EndpointIdempotency,
  Forbidden,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyMissing,
  Invalid,
  parseIdempotencyKey,
  Unauthenticated,
} from '@entifix/core';
import { Context, Effect, Layer, Option } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpApiMiddleware } from 'effect/http-api';

import { NoActiveOrganization } from '../auth/failures.js';
import { permits, resolveRequestPrincipal } from '../auth/require-principal.js';
import {
  CROSSING_TOKEN_HEADER,
  ORGANIZATION_HEADER,
  ServiceCrossingTokenTag,
} from '../auth/require-service-crossing.js';
import { type SharedToken, tokenMatches } from '../auth/shared-token.js';
import { withVerifiedContext } from '../auth/verified-context.js';
import { requireIdempotencyKey } from '../idempotency.js';

/**
 * The guard an endpoint was declared with, as an endpoint annotation, so one
 * middleware per kind reads the permission off the endpoint it guards.
 */
export class EndpointGuardAnnotation extends Context.Service<
  EndpointGuardAnnotation,
  EndpointGuard
>()('@entifix/service-shell/EndpointGuard') {}

/** The endpoint's idempotency declaration, as an endpoint annotation. */
export class EndpointIdempotencyAnnotation extends Context.Service<
  EndpointIdempotencyAnnotation,
  EndpointIdempotency
>()('@entifix/service-shell/EndpointIdempotency') {}

/**
 * The shared token one service of the fleet presents to another, provided by
 * the composition root for endpoints declared `fleet`.
 */
export class FleetTokenTag extends Context.Service<
  FleetTokenTag,
  SharedToken
>()('@entifix/service-shell/FleetToken') {}

/* eslint-disable @typescript-eslint/no-explicit-any -- the API is assembled
   from descriptors at runtime; the descriptors carry the types. */
type AnyEffect = Effect.Effect<any, any, any>;
type Middleware = (
  httpEffect: AnyEffect,
  options: {
    readonly endpoint: {
      readonly annotations: Context.Context<never>;
      readonly method: string;
      readonly path: string;
    };
  },
) => AnyEffect;
/* eslint-enable @typescript-eslint/no-explicit-any */

const guardOf = (options: Parameters<Middleware>[1]): EndpointGuard =>
  Context.getUnsafe(
    options.endpoint.annotations as Context.Context<EndpointGuardAnnotation>,
    EndpointGuardAnnotation,
  );

const unauthenticated = Effect.fail(new Unauthenticated());

/**
 * The session's principal, or `unauthenticated`. An empty cookie and an empty
 * bearer are both no credential: `resolveRequestPrincipal` reads `''` as
 * absent before anything is verified.
 */
const principal = Effect.flatMap(resolveRequestPrincipal, found =>
  Option.isSome(found) ? Effect.succeed(found.value) : unauthenticated,
);

const permitted = (who: RequestPrincipal, guard: EndpointGuard) =>
  'permission' in guard
    ? Effect.flatMap(permits(who, guard.permission), allowed =>
        allowed
          ? Effect.void
          : Effect.fail(new Forbidden({ permission: guard.permission })),
      )
    : Effect.void;

const asCaller = (who: RequestPrincipal, httpEffect: AnyEffect) =>
  withVerifiedContext(who, () =>
    Effect.provideService(httpEffect, RequestPrincipalTag, who),
  );

const sessionGuard: Middleware = (httpEffect, options) =>
  Effect.gen(function* () {
    const who = yield* principal;
    yield* permitted(who, guardOf(options));
    return yield* asCaller(who, httpEffect);
  });

const organizationGuard: Middleware = (httpEffect, options) =>
  Effect.gen(function* () {
    const who = yield* principal;
    yield* permitted(who, guardOf(options));
    // The organization comes from the verified token and nowhere else.
    if (who.organizationId === undefined)
      return yield* Effect.fail(new NoActiveOrganization());
    return yield* asCaller(
      who,
      Effect.provideService(httpEffect, OrganizationIdTag, who.organizationId),
    );
  });

const organizationRequired = new Invalid({
  errors: [
    {
      pointer: `/headers/${ORGANIZATION_HEADER}`,
      detail: `${ORGANIZATION_HEADER} is required`,
      code: 'organizationRequired',
    },
  ],
});

const crossingGuard: Middleware = (httpEffect, options) =>
  Effect.gen(function* () {
    // The builder mounts this middleware for a crossing guard only.
    const guard = guardOf(options) as Extract<
      EndpointGuard,
      { kind: 'crossing' }
    >;
    const request = yield* HttpServerRequest.HttpServerRequest;
    // Two accepted credentials make the weaker one the security level, so a
    // crossing endpoint refuses a request that also carries a session — any
    // session credential at all, verified or not.
    if (carriesSession(request)) return yield* unauthenticated;

    const expected = yield* ServiceCrossingTokenTag;
    if (!tokenMatches(request.headers[CROSSING_TOKEN_HEADER], expected))
      return yield* unauthenticated;

    const policy = yield* ServiceCrossingPolicyTag;
    if (!policy.allows(guard.permission))
      return yield* Effect.fail(
        new Forbidden({ permission: guard.permission }),
      );

    if (!guard.organization) return yield* httpEffect;
    const organizationId = request.headers[ORGANIZATION_HEADER]?.trim();
    if (organizationId === undefined || organizationId === '')
      return yield* Effect.fail(organizationRequired);
    return yield* Effect.provideService(
      httpEffect,
      OrganizationIdTag,
      organizationId,
    );
  });

const carriesSession = (
  request: HttpServerRequest.HttpServerRequest,
): boolean =>
  (request.cookies[ACCESS_COOKIE] ?? '') !== '' ||
  (request.headers['authorization'] ?? '') !== '';

const fleetGuard: Middleware = httpEffect =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const fleet = yield* FleetTokenTag;
    if (!tokenMatches(request.headers[fleet.header], fleet.token()))
      return yield* unauthenticated;
    return yield* httpEffect;
  });

/**
 * The `Idempotency-Key` handling an endpoint declared. `unit` decodes the key
 * for the handler's unit of work and records nothing; `edge` remembers the
 * answer in the idempotency store. One write is recorded by one layer.
 */
const idempotencyGuard: Middleware = (httpEffect, options) =>
  Effect.gen(function* () {
    const mode = Context.getUnsafe(
      options.endpoint
        .annotations as Context.Context<EndpointIdempotencyAnnotation>,
      EndpointIdempotencyAnnotation,
    );
    const request = yield* HttpServerRequest.HttpServerRequest;
    const key = parseIdempotencyKey(request.headers[IDEMPOTENCY_KEY_HEADER]);
    if (key === undefined)
      return yield* Effect.fail(new IdempotencyKeyMissing());
    const keyed = Effect.provideService(httpEffect, IdempotencyKeyTag, key);
    if (mode === 'unit') return yield* keyed;
    // The guard ran first and provided the principal on a session endpoint;
    // two callers choosing one key never collide.
    const caller = Option.match(
      yield* Effect.serviceOption(RequestPrincipalTag),
      {
        onNone: () => 'service',
        onSome: who => String(who.userId),
      },
    );
    // The route's template, not the concrete path: the dedup key is per
    // route, and the fingerprint is what tells two records on it apart.
    return yield* requireIdempotencyKey({
      route: `${options.endpoint.method} ${options.endpoint.path}`,
      caller,
    })(keyed);
  });

export class SessionGuard extends HttpApiMiddleware.Service<SessionGuard>()(
  '@entifix/service-shell/SessionGuard',
) {}
export class OrganizationGuard extends HttpApiMiddleware.Service<OrganizationGuard>()(
  '@entifix/service-shell/OrganizationGuard',
) {}
export class CrossingGuard extends HttpApiMiddleware.Service<CrossingGuard>()(
  '@entifix/service-shell/CrossingGuard',
) {}
export class FleetGuard extends HttpApiMiddleware.Service<FleetGuard>()(
  '@entifix/service-shell/FleetGuard',
) {}
export class IdempotencyGuard extends HttpApiMiddleware.Service<IdempotencyGuard>()(
  '@entifix/service-shell/IdempotencyGuard',
) {}

/** The middleware each guard kind mounts; `public` mounts none. */
export const GUARD_MIDDLEWARE = {
  public: undefined,
  session: SessionGuard,
  permission: SessionGuard,
  organization: OrganizationGuard,
  crossing: CrossingGuard,
  fleet: FleetGuard,
} as const satisfies Record<EndpointGuardKind, unknown>;

/** Every guard's implementation, provided to the API once. */
export const guardLayers = Layer.mergeAll(
  Layer.succeed(SessionGuard)(sessionGuard as never),
  Layer.succeed(OrganizationGuard)(organizationGuard as never),
  Layer.succeed(CrossingGuard)(crossingGuard as never),
  Layer.succeed(FleetGuard)(fleetGuard as never),
  Layer.succeed(IdempotencyGuard)(idempotencyGuard as never),
);

/** The services a guard kind reads, so a host that omits one does not compile. */
export type GuardServices<Kind extends EndpointGuardKind> =
  Kind extends 'public'
    ? never
    : Kind extends 'session' | 'permission' | 'organization'
      ? TokenServiceTag | PolicyDecisionTag
      : Kind extends 'crossing'
        ? ServiceCrossingTokenTag | ServiceCrossingPolicyTag
        : Kind extends 'fleet'
          ? FleetTokenTag
          : never;

/** The services an idempotency declaration reads. */
export type IdempotencyServices<Mode> = Mode extends 'edge'
  ? IdempotencyStoreTag
  : never;
