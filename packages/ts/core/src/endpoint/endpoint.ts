import { type Effect, Schema, SchemaTransformation } from 'effect';

import { extractMetaEntity } from '../entity-definition/helpers/entity-definition-helpers.js';
import type {
  EntifixFailure,
  FailureClass,
  TechnicalCategory,
} from '../failure/failure.js';
import type { Entity, EntityConstructor } from '../types/Entity.js';

/**
 * Who may call an endpoint, and with which credential
 * ([ADR 0020](../../../../../docs/adr/0020-endpoints-are-descriptors-and-the-shell-builds-an-httpapi.md)).
 * Exactly one per endpoint. The shell implements each kind once.
 *
 * - `public` — no credential.
 * - `session` — a verified session, and nothing more.
 * - `permission` — a session whose roles grant `permission`.
 * - `organization` — the same, acting for the session's active organization.
 * - `crossing` — a service crossing token and `permission`. With
 *   `organization: true` the caller names the organization, because the data's
 *   owner was handed to it rather than chosen.
 * - `fleet` — the shared token one service of the fleet presents to another.
 */
/** A permission as `<domain>:<entityKey>:<action>`. */
export type EndpointPermission = `${string}:${string}:${string}`;

export type EndpointGuard =
  | { readonly kind: 'public' }
  | { readonly kind: 'session' }
  | { readonly kind: 'permission'; readonly permission: EndpointPermission }
  | { readonly kind: 'organization'; readonly permission: EndpointPermission }
  | {
      readonly kind: 'crossing';
      readonly permission: EndpointPermission;
      readonly organization: boolean;
    }
  | { readonly kind: 'fleet' };

export type EndpointGuardKind = EndpointGuard['kind'];

/**
 * Which layer remembers an `Idempotency-Key`. One write is recorded by one
 * layer, never both: `unit` when the handler writes through a unit of work,
 * which claims the key in the same transaction as the write; `edge` when it
 * does not, and the shell's idempotency store remembers the answer.
 */
export type EndpointIdempotency = 'unit' | 'edge';

export type EndpointMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A schema, or the fields of a struct — normalised to a schema when served. */
export type EndpointSchema = Schema.Top | Schema.Struct.Fields;

/** The schema an {@link EndpointSchema} stands for. */
export type SchemaOf<S> = S extends Schema.Top
  ? S
  : S extends Schema.Struct.Fields
    ? Schema.Struct<S>
    : never;

type TypeOf<S> = SchemaOf<S>['Type'];

/**
 * An endpoint, described with Schema and nothing about HTTP beyond its method
 * and path: no status, no content type, no annotation. A cell exports these;
 * the shell turns them into an API.
 */
export interface EndpointDescriptor<
  Name extends string = string,
  Method extends EndpointMethod = EndpointMethod,
  Path extends `/${string}` = `/${string}`,
  Params extends EndpointSchema | undefined = EndpointSchema | undefined,
  Query extends EndpointSchema | undefined = EndpointSchema | undefined,
  Payload extends EndpointSchema | undefined = EndpointSchema | undefined,
  Success extends Schema.Top = Schema.Top,
  Errors extends ReadonlyArray<FailureClass> = ReadonlyArray<FailureClass>,
  Guard extends EndpointGuard = EndpointGuard,
  Idempotency extends EndpointIdempotency | undefined =
    EndpointIdempotency | undefined,
> {
  readonly name: Name;
  readonly method: Method;
  readonly path: Path;
  readonly params?: Params;
  readonly query?: Query;
  readonly payload?: Payload;
  readonly success: Success;
  /**
   * Every business failure the handler may answer with. Only failure classes:
   * a refusal with no category does not compile. Technical failures are not
   * listed — every endpoint may answer with one.
   */
  readonly errors: Errors;
  readonly guard: Guard;
  readonly idempotent?: Idempotency;
  /** The `@useCase()` this endpoint serves, when it is a verb. */
  readonly useCase?: string;
}

/** Any descriptor. */
export type AnyEndpoint = EndpointDescriptor<
  string,
  EndpointMethod,
  `/${string}`,
  EndpointSchema | undefined,
  EndpointSchema | undefined,
  EndpointSchema | undefined,
  Schema.Top,
  ReadonlyArray<FailureClass>,
  EndpointGuard,
  EndpointIdempotency | undefined
>;

/**
 * Declare one endpoint. The literal types of its name, path and schemas are
 * kept, so a handler and a client are typed from it.
 */
export const defineEndpoint = <
  const Name extends string,
  const Method extends EndpointMethod,
  const Path extends `/${string}`,
  Success extends Schema.Top,
  const Errors extends ReadonlyArray<FailureClass> = readonly [],
  Params extends EndpointSchema | undefined = undefined,
  Query extends EndpointSchema | undefined = undefined,
  Payload extends EndpointSchema | undefined = undefined,
  const Guard extends EndpointGuard = EndpointGuard,
  const Idempotency extends EndpointIdempotency | undefined = undefined,
>(
  descriptor: EndpointDescriptor<
    Name,
    Method,
    Path,
    Params,
    Query,
    Payload,
    Success,
    Errors,
    Guard,
    Idempotency
  >,
): EndpointDescriptor<
  Name,
  Method,
  Path,
  Params,
  Query,
  Payload,
  Success,
  Errors,
  Guard,
  Idempotency
> => descriptor;

/** Declare several endpoints, keeping each one's literal types. */
export const defineEndpoints = <
  const Endpoints extends ReadonlyArray<AnyEndpoint>,
>(
  ...endpoints: Endpoints
): Endpoints => endpoints;

/** A technical failure: a non-answer every endpoint may produce undeclared. */
export type TechnicalFailure = EntifixFailure<
  string,
  string,
  TechnicalCategory
>;

/** The business failures a descriptor declares, as instances. */
export type DeclaredFailure<D> =
  D extends EndpointDescriptor<
    string,
    EndpointMethod,
    `/${string}`,
    EndpointSchema | undefined,
    EndpointSchema | undefined,
    EndpointSchema | undefined,
    Schema.Top,
    infer Errors,
    EndpointGuard,
    EndpointIdempotency | undefined
  >
    ? InstanceType<Errors[number]>
    : never;

/** What a handler receives: the decoded parts the descriptor declares. */
export type EndpointRequest<D> =
  D extends EndpointDescriptor<
    string,
    EndpointMethod,
    `/${string}`,
    infer Params,
    infer Query,
    infer Payload,
    Schema.Top,
    ReadonlyArray<FailureClass>,
    EndpointGuard,
    EndpointIdempotency | undefined
  >
    ? (Params extends EndpointSchema
        ? { readonly params: TypeOf<Params> }
        : unknown) &
        (Query extends EndpointSchema
          ? { readonly query: TypeOf<Query> }
          : unknown) &
        (Payload extends EndpointSchema
          ? { readonly payload: TypeOf<Payload> }
          : unknown)
    : never;

/** What a handler answers with. */
export type EndpointSuccess<D> =
  D extends EndpointDescriptor<
    string,
    EndpointMethod,
    `/${string}`,
    EndpointSchema | undefined,
    EndpointSchema | undefined,
    EndpointSchema | undefined,
    infer Success,
    ReadonlyArray<FailureClass>,
    EndpointGuard,
    EndpointIdempotency | undefined
  >
    ? Success['Type']
    : never;

/** A handler for `D`: a plain effect, with no transport in its type. */
export type EndpointHandler<D, R> = (
  request: EndpointRequest<D>,
) => Effect.Effect<
  EndpointSuccess<D>,
  DeclaredFailure<D> | TechnicalFailure,
  R
>;

/** A descriptor paired with the handler that serves it. */
export interface Implemented<D extends AnyEndpoint = AnyEndpoint, R = unknown> {
  readonly descriptor: D;
  readonly handler: EndpointHandler<D, R>;
}

/**
 * Pair a descriptor with its handler. A handler failing with a business
 * failure the descriptor does not declare does not compile.
 */
export const implement = <D extends AnyEndpoint, R>(
  descriptor: D,
  handler: EndpointHandler<D, R>,
): Implemented<D, R> => ({ descriptor, handler });

/**
 * The entity's key as a literal, checked against `@entity({ key })` when the
 * module loads, so a path built from it cannot name a key the entity does not
 * carry.
 */
export const entityKey = <T extends Entity, const K extends string>(
  entityConstructor: EntityConstructor<T>,
  key: K,
): K => {
  const declared = extractMetaEntity(entityConstructor).key;
  if (declared !== key)
    throw new Error(
      `entityKey(${entityConstructor.name}, '${key}') does not match ` +
        `@entity({ key: ${declared === undefined ? 'undefined' : `'${declared}'`} })`,
    );
  return key;
};

/**
 * A body an endpoint sends without describing it: whatever the handler
 * answers, as its JSON — `Date`s as ISO strings, `undefined` members dropped,
 * the way `JSON.stringify` writes it. For a record whose shape the entity
 * describes rather than a schema, and for an opaque document such as an
 * OpenAPI one. A body the endpoint can describe should be a schema instead.
 */
export const JsonBody: Schema.Codec<unknown, unknown> = Schema.Unknown.pipe(
  Schema.decodeTo(
    Schema.Unknown,
    SchemaTransformation.transform({
      decode: value => value,
      encode: value =>
        value === undefined
          ? null
          : (JSON.parse(JSON.stringify(value)) as unknown),
    }),
  ),
);
