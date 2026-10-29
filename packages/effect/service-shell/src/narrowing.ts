import {
  dryRun,
  type ResolutionRule,
  type VerifiedContext,
} from '@entifix/business';
import type {
  Entity,
  EntityId,
  EntityLoadRequest,
  FilterGroup,
} from '@entifix/core';

/**
 * Which records of an entity a caller may see: every one, none, or those a
 * filter keeps ([ADR 0015](../../../../docs/adr/0015-composed-flows-and-use-case-resolution.md)).
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

/** The narrowing `rules` choose for `context`. */
export const narrowingFor = <T extends Entity>(
  rules: NarrowingRules<T>,
  context: VerifiedContext,
): Narrowing<T> => {
  const chosen = dryRun(rules, context);
  if (chosen === undefined) return 'nothing';
  // `dryRun` answers the index of a rule it found, so the rule is there.
  const rule = rules[chosen.rule] as NarrowingRules<T>[number];
  return rule.variant.impl(context);
};

/** Conjoins a filter narrowing onto a load request; `unscoped` leaves it as it is. */
export const narrowLoadRequest = <T extends Entity>(
  request: EntityLoadRequest<T>,
  narrowing: Exclude<Narrowing<T>, 'nothing'>,
): EntityLoadRequest<T> =>
  narrowing === 'unscoped'
    ? request
    : { ...request, filtering: [...(request.filtering ?? []), narrowing] };

/**
 * The by-id read under a narrowing: a load of the narrowing plus id equality,
 * so a record out of the caller's sight answers exactly as an absent one does,
 * and the list and the read can never disagree about which records those are.
 */
export const narrowedByIdRequest = <T extends Entity>(
  narrowing: FilterGroup<T>,
  id: EntityId,
): EntityLoadRequest<T> =>
  ({
    filtering: [narrowing, { property: 'id', operator: 'eq', value: id }],
  }) as unknown as EntityLoadRequest<T>;
