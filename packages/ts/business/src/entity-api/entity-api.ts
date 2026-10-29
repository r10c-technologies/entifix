import {
  type EndpointIdempotency,
  type EndpointSchema,
  type EntifixEnvelopeLink,
  type EntifixFailure,
  type Entity,
  type EntityConstructor,
  type EntityId,
  extractUseCase,
  type FailureClass,
  type FilterGroup,
  type MetaUseCase,
  type UseCaseConstructor,
} from '@entifix/core';
import type { Effect } from 'effect';

import type { RequestPrincipal } from '../request/request-context.js';
import type { ResolutionRule } from '../resolve/resolve.js';
import type { VerifiedContext } from '../resolve/verified-context.js';

/** The five generic verbs an entity's endpoints can serve. */
export type EntityApiVerb = 'list' | 'get' | 'create' | 'update' | 'delete';

/**
 * Who may reach an entity's endpoints. The permission is derived from the
 * entity and the verb, so it is never written here.
 */
export type EntityApiGuard =
  | { readonly kind: 'public' }
  | { readonly kind: 'permission' }
  | { readonly kind: 'organization' }
  | { readonly kind: 'crossing'; readonly organization: boolean };

/** The affordances an entity's endpoints derive from the verbs they serve. */
export interface EntityApiLinks {
  readonly record: (id: EntityId) => EntifixEnvelopeLink[];
  readonly collection: () => EntifixEnvelopeLink[];
}

/** What a `prepare`, an override or a verb knows about the caller. */
export interface EntityApiContext {
  readonly organizationId?: string;
  readonly principal?: RequestPrincipal;
  readonly verified?: VerifiedContext;
  readonly links: EntityApiLinks;
}

/** What an override's handler receives: the decoded parts of its request. */
export interface EntityApiRequest {
  readonly params?: { readonly id?: string };
  readonly payload?: unknown;
}

/**
 * Which records of an entity a caller may see: every one, none, or those a
 * filter keeps ([ADR 0015](../../../../../docs/adr/0015-composed-flows-and-use-case-resolution.md)).
 * A filter is conjoined onto the load request, so a query string can only
 * narrow it further and no `or` in it can escape.
 */
export type Narrowing<T extends Entity> =
  'unscoped' | 'nothing' | FilterGroup<T>;

/**
 * A read's narrowing as ordered resolver rules over the verified context: the
 * first variant the caller is entitled to and whose predicate holds builds the
 * narrowing. A caller no rule matches sees **nothing** — the direction a
 * missing rule must fail in.
 */
export type NarrowingRules<T extends Entity> = readonly ResolutionRule<
  (context: VerifiedContext) => Narrowing<T>
>[];

/**
 * One verb served by a handler of the host's instead of the generic one. It
 * keeps the group's path and links, and may change the guard, the payload,
 * the failures and the idempotency the verb declares.
 */
export interface EntityVerbOverride<R> {
  readonly guard?: EntityApiGuard;
  readonly idempotent?: EndpointIdempotency;
  readonly errors?: readonly FailureClass[];
  /** The body the verb takes instead of an entity envelope. */
  readonly payload?: EndpointSchema;
  readonly handler: (
    request: EntityApiRequest,
    context: EntityApiContext,
  ) => Effect.Effect<unknown, EntifixFailure, R>;
}

/**
 * A `@useCase()` verb's endpoint: its path, method, permission and contract
 * come from the declaration, and only who may call it and what it does are
 * written here.
 */
export interface VerbEndpoint<R> {
  readonly useCase: MetaUseCase;
  /** Defaults to the group's write guard. */
  readonly guard?: EntityApiGuard;
  readonly idempotent?: EndpointIdempotency;
  readonly handler: (
    request: EntityApiRequest,
    context: EntityApiContext,
  ) => Effect.Effect<unknown, EntifixFailure, R>;
}

/** Serve a `@useCase()` class's verb on its entity's endpoints. */
export const verbEndpoint = <
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inferred from the options
  const O extends Omit<VerbEndpoint<any>, 'useCase'>,
>(
  useCaseClass: UseCaseConstructor,
  options: O,
): O & { readonly useCase: MetaUseCase } => ({
  ...options,
  useCase: extractUseCase(useCaseClass),
});

/** What an entity's endpoints serve, and under which rules. */
export interface EntityApiOptions<T extends Entity, R> {
  readonly verbs: readonly EntityApiVerb[];
  /** One guard for every verb, or one for the reads and one for the writes. */
  readonly guard:
    | EntityApiGuard
    | { readonly read: EntityApiGuard; readonly write: EntityApiGuard };
  /** Narrows the reads, and the facet counts, to what this caller may see. */
  readonly narrowing?: NarrowingRules<T>;
  /** Serve `$facets` beside the list, under the list's guard and narrowing. */
  readonly facets?: boolean;
  /** Runs on every generic create and update, before the save. */
  readonly prepare?: (
    entity: T,
    context: EntityApiContext & { readonly verb: 'create' | 'update' },
  ) => Effect.Effect<T, EntifixFailure, R>;
  /** The business failures `prepare` may answer with, for the contract. */
  readonly errors?: readonly FailureClass[];
  readonly override?: Partial<Record<EntityApiVerb, EntityVerbOverride<R>>>;
  /**
   * The entity's `@useCase()` verbs, one endpoint each. Every verb the entity
   * declares must be here and none another entity declares, or serving the
   * declaration throws.
   */
  readonly useCases?: readonly VerbEndpoint<R>[];
}

/**
 * An entity's endpoints as a value: which verbs, behind which guards, with
 * which handlers. Declaring them needs no HTTP — a domain's cell declares, and
 * the shell serves the declaration with `entityApi`
 * ([ADR 0020](../../../../../docs/adr/0020-endpoints-are-descriptors-and-the-shell-builds-an-httpapi.md)).
 */
export interface EntityApiDeclaration<
  T extends Entity,
  K extends string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inferred from the options
  O extends EntityApiOptions<T, any>,
> {
  readonly entity: EntityConstructor<T>;
  readonly key: K;
  readonly options: O;
}

/** `O`, with every key `Shape` does not name typed `never`. */
type Exact<O, Shape> = O & Record<Exclude<keyof O, keyof Shape>, never>;

/**
 * Declare an entity's endpoints, to be served by the shell. An option the
 * declaration does not know is a compile error rather than a value nobody
 * reads — `compositions` included, which the shell adds when it serves.
 */
export const defineEntityApi = <
  T extends Entity,
  const K extends string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inferred from the options
  const O extends EntityApiOptions<T, any>,
>(
  entity: EntityConstructor<T>,
  key: K,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inferred from the options
  options: Exact<O, EntityApiOptions<T, any>>,
): EntityApiDeclaration<T, K, O> => ({ entity, key, options });
