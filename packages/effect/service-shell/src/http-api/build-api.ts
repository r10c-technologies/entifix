import type {
  IdempotencyKeyTag,
  OrganizationIdTag,
  RequestPrincipalTag,
  VerifiedContextTag,
} from '@entifix/business';
import {
  type AnyEndpoint,
  bodyEncodingOf,
  Contention,
  type DeadlineTag,
  type EndpointSchema,
  type EntifixFailure,
  type FailureClass,
  Forbidden,
  IdempotencyKeyInFlight,
  IdempotencyKeyMissing,
  IdempotencyKeyReused,
  type Implemented,
  Internal,
  Invalid,
  Overloaded,
  ProtocolFailure,
  Timeout,
  Unauthenticated,
  Unavailable,
  UpstreamUnavailable,
} from '@entifix/core';
import {
  Effect,
  type FileSystem,
  Layer,
  type Path,
  Schema,
  SchemaIssue,
} from 'effect';
import type { Etag, HttpPlatform, HttpRouter } from 'effect/http';
import { HttpServerResponse } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from 'effect/http-api';

import { NoActiveOrganization } from '../auth/failures.js';
import {
  defaultFailurePolicy,
  type FailurePolicy,
  respond,
} from '../respond.js';
import {
  EndpointGuardAnnotation,
  EndpointIdempotencyAnnotation,
  GUARD_MIDDLEWARE,
  guardLayers,
  type GuardServices,
  IdempotencyGuard,
  type IdempotencyServices,
} from './guards.js';
import { problemCodec } from './problem-codec.js';

/**
 * A named set of implemented endpoints — one `HttpApiGroup` once built. A slice
 * groups by entity or by concern; the name is what an OpenAPI document and a
 * client namespace it under.
 */
export interface EndpointGroup<
  Endpoint extends AnyEndpoint = AnyEndpoint,
  R = never,
> {
  readonly name: string;
  readonly endpoints: ReadonlyArray<Implemented<Endpoint, R>>;
}

/** Any group, whatever its handlers need — the constraint a builder takes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a constraint
export type AnyEndpointGroup = EndpointGroup<AnyEndpoint, any>;

/* eslint-disable @typescript-eslint/no-explicit-any -- inference sites */
type EndpointOf<I> = I extends Implemented<infer D, any> ? D : never;
type RequirementsOf<I> = I extends Implemented<any, infer R> ? R : never;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Group implemented endpoints under one name. */
export const endpointGroup = <
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Endpoints extends ReadonlyArray<Implemented<any, any>>,
>(
  name: string,
  ...endpoints: Endpoints
): EndpointGroup<
  EndpointOf<Endpoints[number]>,
  RequirementsOf<Endpoints[number]>
> => ({
  name,
  endpoints: endpoints as never,
});

/** What the shell provides a handler: the verified request context. */
export type ProvidedToHandlers =
  | RequestPrincipalTag
  | OrganizationIdTag
  | IdempotencyKeyTag
  | VerifiedContextTag
  | DeadlineTag;

/**
 * What serving `Groups` requires of the composition root: what the handlers
 * need beyond the request context, plus what each declared guard and
 * idempotency mode reads. A host that omits one does not compile.
 */
export type ServedRequirements<Groups extends ReadonlyArray<AnyEndpointGroup>> =
  GroupRequirements<Groups[number]>;

// Distributive over the groups, and `never` for none.
type GroupRequirements<Group> =
  Group extends EndpointGroup<infer Endpoint, infer R>
    ? | Exclude<R, ProvidedToHandlers>
      | GuardServices<Endpoint['guard']['kind']>
      | IdempotencyServices<Endpoint['idempotent']>
    : never;

/** What serving an API needs from the HTTP server itself. */
export type ServedPlatform =
  | HttpRouter.HttpRouter
  | Etag.Generator
  | FileSystem.FileSystem
  | HttpPlatform.HttpPlatform
  | Path.Path;

/** `METHOD /path` for every endpoint — what a register diffs a service against. */
export const endpointsOf = (
  groups: ReadonlyArray<AnyEndpointGroup>,
): readonly string[] =>
  groups.flatMap(group =>
    group.endpoints.map(
      ({ descriptor }) => `${descriptor.method} ${descriptor.path}`,
    ),
  );

/** The failures every endpoint may answer, whether or not it declares them. */
const TECHNICAL: readonly FailureClass[] = [
  Invalid,
  Internal,
  Unavailable,
  UpstreamUnavailable,
  Timeout,
  Overloaded,
  Contention,
  ProtocolFailure,
];

const GUARD_FAILURES: Readonly<
  Record<AnyEndpoint['guard']['kind'], readonly FailureClass[]>
> = {
  public: [],
  session: [Unauthenticated],
  permission: [Unauthenticated, Forbidden],
  organization: [Unauthenticated, Forbidden, NoActiveOrganization],
  crossing: [Unauthenticated, Forbidden],
  fleet: [Unauthenticated],
};

const IDEMPOTENCY_FAILURES: readonly FailureClass[] = [
  IdempotencyKeyMissing,
  IdempotencyKeyReused,
  IdempotencyKeyInFlight,
];

/** The status a failure class answers with under `policy`. */
export const statusForClass = (
  failureClass: FailureClass,
  policy: FailurePolicy,
): number =>
  policy.tagStatus[failureClass.identifier] ??
  policy.categoryStatus[
    (failureClass.prototype as unknown as EntifixFailure).category
  ];

const errorSchemas = (descriptor: AnyEndpoint, policy: FailurePolicy) =>
  [
    ...new Set([
      ...descriptor.errors,
      ...GUARD_FAILURES[descriptor.guard.kind],
      ...(descriptor.idempotent === undefined ? [] : IDEMPOTENCY_FAILURES),
      ...TECHNICAL,
    ]),
  ].map(failureClass =>
    problemCodec(failureClass, statusForClass(failureClass, policy)),
  );

const toSchema = (schema: EndpointSchema | undefined) =>
  schema === undefined
    ? undefined
    : Schema.isSchema(schema)
      ? schema
      : Schema.Struct(schema);

/** A payload on the wire it declared: JSON unless it said text or a form. */
const toPayload = (schema: EndpointSchema | undefined) => {
  const payload = toSchema(schema);
  if (payload === undefined) return undefined;
  switch (bodyEncodingOf(payload)) {
    case 'text':
      // `TextBody` is a string schema; the marker is what says so here.
      return (payload as Schema.String).pipe(HttpApiSchema.asText());
    case 'form':
      return payload.pipe(HttpApiSchema.asFormUrlEncoded());
    default:
      return payload;
  }
};

/**
 * The outermost middleware of every endpoint: `respond` under the API's
 * policy, after a schema error has become `invalid` with one entry per broken
 * field. A response that fails to encode is the service's own fault and stays
 * a defect.
 */
export class Respond extends HttpApiMiddleware.Service<Respond>()(
  '@entifix/service-shell/Respond',
) {}

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

/** The `invalid` failure a request that fails its schema answers with. */
export const invalidRequest = (
  error: HttpApiError.HttpApiSchemaError,
): Invalid => {
  const where = error.kind.toLowerCase();
  const { issues } = formatIssues(error.cause.issue);
  return new Invalid({
    errors: issues.map(issue => ({
      // Effect's formatter always sets the path — `[]` for the part itself —
      // though the Standard Schema type it answers with leaves it optional.
      pointer: `/${[where, ...(issue.path as readonly PropertyKey[]).map(String)].join('/')}`,
      detail: issue.message,
      code: 'schema',
    })),
  });
};

const REQUEST_PARTS: ReadonlySet<HttpApiError.HttpApiSchemaError['kind']> =
  new Set(['Params', 'Query', 'Payload', 'Headers']);

const respondLayer = (policy: FailurePolicy) =>
  Layer.succeed(Respond)(((httpEffect: Effect.Effect<never, unknown, never>) =>
    respond(
      httpEffect.pipe(
        Effect.catchIf(
          (error: unknown): error is HttpApiError.HttpApiSchemaError =>
            HttpApiError.HttpApiSchemaError.is(error) &&
            REQUEST_PARTS.has(error.kind),
          error => Effect.fail(invalidRequest(error)),
        ),
      ) as never,
      policy,
    ).pipe(Effect.map(uncachedByDefault))) as never);

/**
 * Every answer `no-store` unless its endpoint chose a cache policy of its own.
 * An API answer carries a principal, a token or a tenant's records far more
 * often than anything a cache could share, and a token response must not be
 * stored at all (RFC 6749 §5.1) — so the safe default is the shell's, and an
 * endpoint that wants caching (an `ETag`ed metadata document) says so.
 */
const uncachedByDefault = (
  response: HttpServerResponse.HttpServerResponse,
): HttpServerResponse.HttpServerResponse =>
  response.headers['cache-control'] === undefined
    ? HttpServerResponse.setHeader(response, 'cache-control', 'no-store')
    : response;

const toEndpoint = (descriptor: AnyEndpoint, policy: FailurePolicy) => {
  const params = toSchema(descriptor.params);
  const query = toSchema(descriptor.query);
  const payload = toPayload(descriptor.payload);
  const headers = toSchema(descriptor.headers);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assembled at runtime
  let endpoint: any = HttpApiEndpoint.make(descriptor.method)(
    descriptor.name,
    descriptor.path,
    {
      ...(params === undefined ? {} : { params }),
      ...(query === undefined ? {} : { query }),
      ...(payload === undefined ? {} : { payload }),
      ...(headers === undefined ? {} : { headers }),
      success: descriptor.success,
      error: errorSchemas(descriptor, policy),
    } as never,
  ).annotate(EndpointGuardAnnotation, descriptor.guard);
  // Order is outermost last: idempotency runs inside the guard, so it sees
  // the principal the guard verified; `Respond` wraps everything.
  if (descriptor.idempotent !== undefined)
    endpoint = endpoint
      .annotate(EndpointIdempotencyAnnotation, descriptor.idempotent)
      .middleware(IdempotencyGuard);
  const guard = GUARD_MIDDLEWARE[descriptor.guard.kind];
  if (guard !== undefined) endpoint = endpoint.middleware(guard);
  return endpoint.middleware(Respond);
};

export interface ApiOptions {
  /** The status and log table; the framework's defaults when absent. */
  readonly policy?: FailurePolicy;
}

/**
 * The `HttpApi` a set of groups describes. Every endpoint's failures carry the
 * status the policy gives them, and two endpoints that share a method and
 * path throw here rather than shadowing each other at runtime.
 */
export const buildApi = (
  name: string,
  groups: ReadonlyArray<AnyEndpointGroup>,
  options: ApiOptions = {},
): HttpApi.Top => {
  const policy = options.policy ?? defaultFailurePolicy;
  const seen = new Set<string>();
  for (const target of endpointsOf(groups)) {
    if (seen.has(target)) throw new Error(`'${name}' declares ${target} twice`);
    seen.add(target);
  }
  return groups.reduce<HttpApi.Top>(
    (api, group) =>
      api.add(
        group.endpoints.reduce(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assembled at runtime
          (built: any, { descriptor }) =>
            built.add(toEndpoint(descriptor, policy)),
          HttpApiGroup.make(group.name),
        ),
      ) as HttpApi.Top,
    HttpApi.make(name) as unknown as HttpApi.Top,
  );
};

/**
 * Serve `groups` under one API: the routes, every guard, the respond
 * middleware. The layer requires what the handlers, guards and idempotency
 * modes read, plus the HTTP platform the server provides.
 */
export const serveApi = <const Groups extends ReadonlyArray<AnyEndpointGroup>>(
  api: HttpApi.Top,
  groups: Groups,
  options: ApiOptions = {},
): Layer.Layer<never, never, ServedRequirements<Groups> | ServedPlatform> => {
  const handlers = groups.map(group =>
    HttpApiBuilder.group(
      api as never,
      group.name as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assembled at runtime
      (handle: any) =>
        group.endpoints.reduce(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (built: any, { descriptor, handler }) =>
            built.handle(descriptor.name, handler),
          handle,
        ),
    ),
  );
  return HttpApiBuilder.layer(api as never).pipe(
    Layer.provide(
      Layer.mergeAll(...(handlers as unknown as [Layer.Layer<never>])),
    ),
    Layer.provide(guardLayers),
    Layer.provide(respondLayer(options.policy ?? defaultFailurePolicy)),
  ) as never;
};

/** Build and serve in one call, for a host that needs nothing between. */
export const serveEndpoints = <
  const Groups extends ReadonlyArray<AnyEndpointGroup>,
>(
  name: string,
  groups: Groups,
  options: ApiOptions = {},
) => {
  const api = buildApi(name, groups, options);
  return { api, layer: serveApi(api, groups, options) } as const;
};
