import type { Schema } from 'effect';

import type { EntifixError } from '../base-entities/entifix-error/entifix-error.js';

/**
 * The two families every failure belongs to
 * ([ADR 0013](../../../../../docs/adr/0013-failures-are-typed-values-decided-at-the-shell.md)).
 *
 * - `business` — an answer. The request was understood and the answer is no.
 *   Never retried, never trips a breaker.
 * - `technical` — a non-answer. Something stopped the request being answered,
 *   and the layer directly above may retry it.
 */
export type FailureFamily = 'business' | 'technical';

/** The business categories, each with the status it answers by default. */
export const BUSINESS_CATEGORIES = {
  invalid: 400,
  unauthenticated: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  declined: 422,
} as const;

/** The technical categories, each with the status it answers by default. */
export const TECHNICAL_CATEGORIES = {
  contention: 409,
  exhausted: 429,
  unavailable: 503,
  timeout: 504,
  protocol: 502,
  internal: 500,
} as const;

export type BusinessCategory = keyof typeof BUSINESS_CATEGORIES;
export type TechnicalCategory = keyof typeof TECHNICAL_CATEGORIES;

/**
 * The closed set. Every layer branches on it — the shell's status and log
 * tables, the bus's poison rule, the client's inline-versus-toast choice — so
 * it stays small enough for each of them to be exhaustive over. Tags stay open.
 */
export type FailureCategory = BusinessCategory | TechnicalCategory;

export type FamilyOf<C extends FailureCategory> = C extends BusinessCategory
  ? 'business'
  : 'technical';

export const FAILURE_CATEGORIES: readonly FailureCategory[] = [
  ...(Object.keys(BUSINESS_CATEGORIES) as BusinessCategory[]),
  ...(Object.keys(TECHNICAL_CATEGORIES) as TechnicalCategory[]),
];

export const familyOf = <C extends FailureCategory>(category: C): FamilyOf<C> =>
  (category in BUSINESS_CATEGORIES ? 'business' : 'technical') as FamilyOf<C>;

/** The status a category answers with unless a host overrides its tag. */
export const defaultStatus = (category: FailureCategory): number =>
  category in BUSINESS_CATEGORIES
    ? BUSINESS_CATEGORIES[category as BusinessCategory]
    : TECHNICAL_CATEGORIES[category as TechnicalCategory];

/**
 * What every failure carries beyond its own fields. `code` is the permanent,
 * wire-visible key a client translates; `category` and `family` are what every
 * layer above decides by.
 */
export interface FailureFacts<
  Code extends string = string,
  C extends FailureCategory = FailureCategory,
> {
  readonly code: Code;
  readonly category: C;
  readonly family: FamilyOf<C>;
}

/**
 * Any failure the framework or a host raises: a `Schema.TaggedError` carrying
 * its code, category and family.
 */
export interface EntifixFailure<
  Tag extends string = string,
  Code extends string = string,
  C extends FailureCategory = FailureCategory,
> extends FailureFacts<Code, C> {
  readonly _tag: Tag;
  readonly message: string;
}

/** A failure class, as the registry and the problem codec hold it. */
export interface FailureClass {
  new (...args: never[]): EntifixFailure;
  readonly identifier: string;
  readonly fields: Schema.Struct.Fields;
}

/**
 * Members of the problem body that a failure's own fields must not shadow,
 * because the decoder reads them back as the envelope rather than as fields.
 */
export const RESERVED_FIELDS: ReadonlySet<string> = new Set([
  'type',
  'title',
  'status',
  'detail',
  'instance',
  'code',
  'category',
  'family',
  'traceId',
  'retryAfter',
]);

/**
 * What a port or a hook fails with while the framework moves from the
 * `EntifixError` class tree to typed failures: either one. Deleted with the
 * class tree, in the release that removes it.
 */
export type TransitionalFailure = EntifixError | EntifixFailure;
