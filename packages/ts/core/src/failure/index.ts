import { defineFailure } from './define.js';
import {
  and,
  isCategory,
  isFailure,
  isFamily,
  isTag,
  not,
  or,
  when,
} from './predicates.js';
import { lookupFailure, registeredFailures } from './registry.js';

export * from './failure.js';
export * from './generic.js';
export * from './predicates.js';
export * from './problem.js';
export * from './registry.js';

/**
 * Everything a host needs to define and match failures, under one name
 * ([ADR 0013](../../../../../docs/adr/0013-failures-are-typed-values-decided-at-the-shell.md)).
 *
 * ```ts
 * class DuplicateSlug extends Failure.conflict<DuplicateSlug>()(
 *   'DuplicateSlug',
 *   'duplicateSlug',
 *   { slug: Schema.String },
 * ) {}
 *
 * effect.pipe(Effect.catchIf(Failure.isCategory('conflict'), …))
 * ```
 */
export const Failure = {
  invalid: defineFailure('invalid'),
  unauthenticated: defineFailure('unauthenticated'),
  forbidden: defineFailure('forbidden'),
  notFound: defineFailure('notFound'),
  conflict: defineFailure('conflict'),
  declined: defineFailure('declined'),
  contention: defineFailure('contention'),
  exhausted: defineFailure('exhausted'),
  unavailable: defineFailure('unavailable'),
  timeout: defineFailure('timeout'),
  protocol: defineFailure('protocol'),
  internal: defineFailure('internal'),
  is: isFailure,
  isTag,
  isCategory,
  isFamily,
  and,
  or,
  not,
  when,
  lookup: lookupFailure,
  registered: registeredFailures,
} as const;
