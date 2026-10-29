import { Context } from 'effect';

/**
 * The brand that makes a {@link VerifiedContext} impossible to write by hand.
 * Declared and never exported: no module outside this package can name it, so
 * an object literal cannot carry it, and the only way to hold a value of the
 * type is the constructor at `@entifix/business/verified`.
 */
declare const verified: unique symbol;

/**
 * What is known about the caller once the shell has verified them — the only
 * input a variant may be chosen from
 * ([ADR 0015](../../../../../docs/adr/0015-composed-flows-and-use-case-resolution.md)).
 *
 * Every member comes from a verified credential or from configuration, never
 * from the request body: a predicate that read request input would let a
 * caller choose its own implementation.
 */
export interface VerifiedFacts {
  readonly organizationId?: string;
  readonly partyId?: string;
  readonly partyRole?: string;
  readonly entitlements: readonly string[];
  readonly roles: readonly string[];
  /** Where the request came in: `storefront`, `counter`. */
  readonly channel?: string;
  /** Segment tags the caller belongs to. */
  readonly segment?: Readonly<Record<string, string>>;
  /** Feature flags on for this caller. */
  readonly flags: readonly string[];
  /** Configuration dials a predicate may read. */
  readonly config: Readonly<Record<string, unknown>>;
}

/** {@link VerifiedFacts}, branded: proof that a shell built it from a verified principal. */
export type VerifiedContext = VerifiedFacts & { readonly [verified]: true };

/**
 * The verified context of the request in progress, provided per request by the
 * service shell and read by `provideResolved`.
 */
export class VerifiedContextTag extends Context.Service<
  VerifiedContextTag,
  VerifiedContext
>()('@entifix/business/VerifiedContext') {}
