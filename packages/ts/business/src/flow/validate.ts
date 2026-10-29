import { Failure } from '@entifix/core';
import { Effect, Schema } from 'effect';

import type { FragmentCatalog } from './catalog.js';
import {
  type FragmentDescriptor,
  type FragmentKeys,
  type FragmentRequirements,
  jsonSchemaOf,
} from './fragment.js';
import { type Slip, type SlipStep, slipSteps } from './slip.js';

/** One rule a slip broke, named by its tag. */
export interface SlipViolation {
  readonly tag:
    | 'UnknownFragment'
    | 'TooManyPivots'
    | 'MissingCommitPoint'
    | 'RetriableBeforeCommit'
    | 'CompensatableAfterCommit'
    | 'IrreversibleBeforeCommit'
    | 'WaitBeforeCommit'
    | 'ExcludedFromSegment'
    | 'UnsatisfiedInput'
    | 'UnmetRequirement';
  /** The step that broke it, when one step did. */
  readonly step?: string;
  readonly detail: string;
}

/** The facts of a verified context a slip's requirements are checked against. */
export interface RequirementFacts {
  readonly entitlements?: readonly string[];
  readonly roles?: readonly string[];
  readonly partyRole?: string;
  readonly channel?: string;
}

export interface ValidateSlipOptions {
  /** The facts the caller was verified with; requirements go unchecked without them. */
  readonly context?: RequirementFacts;
  /** Keys the flow's start input provides, with their schemas. */
  readonly start?: FragmentKeys;
}

const sameSchema = (
  a: Schema.Codec<unknown, unknown>,
  b: Schema.Codec<unknown, unknown>,
): boolean =>
  a === b ||
  JSON.stringify(jsonSchemaOf(a)) === JSON.stringify(jsonSchemaOf(b));

/** The requirements `facts` do not meet, described; empty when all are met. */
export const unmetRequirements = (
  requires: FragmentRequirements,
  facts: RequirementFacts,
): string[] => {
  const missing: string[] = [];
  for (const entitlement of requires.entitlements ?? [])
    if (!(facts.entitlements ?? []).includes(entitlement))
      missing.push(`entitlement '${entitlement}'`);
  for (const role of requires.roles ?? [])
    if (!(facts.roles ?? []).includes(role)) missing.push(`role '${role}'`);
  if (
    requires.partyRoles !== undefined &&
    !requires.partyRoles.includes(facts.partyRole ?? '')
  )
    missing.push(`party role in ${requires.partyRoles.join(', ')}`);
  if (
    requires.channels !== undefined &&
    !requires.channels.includes(facts.channel ?? '')
  )
    missing.push(`channel in ${requires.channels.join(', ')}`);
  return missing;
};

/**
 * Checks a slip against its catalog and returns **every** violation, one tag
 * per rule, rather than throwing at the first — so a CI job enumerating every
 * composition reports them all in one run. Pure: no clock, no I/O.
 */
export const validateSlip = (
  slip: Slip,
  catalog: FragmentCatalog,
  options: ValidateSlipOptions = {},
): readonly SlipViolation[] => {
  const violations: SlipViolation[] = [];
  const resolved: {
    readonly step: SlipStep;
    readonly fragment: FragmentDescriptor;
  }[] = [];

  for (const step of slipSteps(slip)) {
    const fragment = catalog.get(step.ref);
    if (fragment === undefined)
      violations.push({
        tag: 'UnknownFragment',
        step: step.step,
        detail: `'${step.ref}' is not in the catalog`,
      });
    else resolved.push({ step, fragment });
  }

  const pivots = resolved.filter(({ fragment }) => fragment.kind === 'pivot');
  if (pivots.length > 1)
    violations.push({
      tag: 'TooManyPivots',
      detail: `the slip has ${String(pivots.length)} pivots (${pivots
        .map(({ step }) => step.step)
        .join(', ')}); a flow has one point of no return`,
    });

  const commitAt = resolved.findIndex(
    ({ fragment }) => fragment.kind === 'pivot',
  );
  const hasRetriable = resolved.some(
    ({ fragment }) => fragment.kind === 'retriable',
  );
  if (commitAt === -1 && (hasRetriable || slip.requiresCommitPoint === true))
    violations.push({
      tag: 'MissingCommitPoint',
      detail:
        'the slip needs one commit point — a pivot, or flow.commit@1 — before its first retriable step',
    });

  const provided = new Map<string, Schema.Codec<unknown, unknown>>(
    Object.entries(options.start ?? {}),
  );

  resolved.forEach(({ step, fragment }, index) => {
    const beforeCommit = commitAt === -1 || index < commitAt;
    const afterCommit = commitAt !== -1 && index > commitAt;

    if (fragment.kind === 'retriable' && commitAt !== -1 && index < commitAt)
      violations.push({
        tag: 'RetriableBeforeCommit',
        step: step.step,
        detail: `'${step.ref}' is retriable and runs before the commit point, where a failure must compensate`,
      });
    if (fragment.kind === 'compensatable' && afterCommit)
      violations.push({
        tag: 'CompensatableAfterCommit',
        step: step.step,
        detail: `'${step.ref}' is compensatable and runs after the commit point, where nothing is undone`,
      });
    if (
      fragment.irreversible === true &&
      fragment.kind !== 'pivot' &&
      beforeCommit
    )
      violations.push({
        tag: 'IrreversibleBeforeCommit',
        step: step.step,
        detail: `'${step.ref}' cannot be undone and runs before the commit point`,
      });
    if (fragment.kind === 'wait' && beforeCommit)
      violations.push({
        tag: 'WaitBeforeCommit',
        step: step.step,
        detail: `'${step.ref}' waits before the commit point, holding uncommitted state for as long as it waits`,
      });

    for (const [tag, values] of Object.entries(fragment.excludedFrom ?? {})) {
      const value = (
        step.segment as Record<string, string | undefined> | undefined
      )?.[tag];
      if (value !== undefined && values.includes(value))
        violations.push({
          tag: 'ExcludedFromSegment',
          step: step.step,
          detail: `'${step.ref}' may not run in a segment whose ${tag} is '${value}'`,
        });
    }

    for (const [key, schema] of Object.entries(fragment.consumes ?? {})) {
      const earlier = provided.get(key);
      if (earlier === undefined)
        violations.push({
          tag: 'UnsatisfiedInput',
          step: step.step,
          detail: `'${step.ref}' consumes '${key}', which nothing before it provides`,
        });
      else if (!sameSchema(earlier, schema))
        violations.push({
          tag: 'UnsatisfiedInput',
          step: step.step,
          detail: `'${step.ref}' consumes '${key}' with a schema other than the one provided`,
        });
    }
    for (const [key, schema] of Object.entries(fragment.provides ?? {}))
      provided.set(key, schema);

    if (options.context !== undefined && fragment.requires !== undefined) {
      const missing = unmetRequirements(fragment.requires, options.context);
      if (missing.length > 0)
        violations.push({
          tag: 'UnmetRequirement',
          step: step.step,
          detail: `'${step.ref}' requires ${missing.join(', ')}`,
        });
    }
  });

  return violations;
};

const SlipViolationSchema = Schema.Struct({
  tag: Schema.String,
  step: Schema.optionalKey(Schema.String),
  detail: Schema.String,
});

/**
 * A flow that cannot be composed for this caller: the slip broke at least one
 * rule. Every violation travels with it.
 */
export class CompositionRefused extends Failure.declined<CompositionRefused>()(
  'CompositionRefused',
  'flowNotComposable',
  { violations: Schema.Array(SlipViolationSchema) },
  {
    message: ({ violations }) =>
      `the flow cannot be composed: ${violations.map(v => v.tag).join(', ')}`,
  },
) {}

/**
 * A flow this caller is not offered: every rule the slip broke is a step's
 * requirement — an entitlement, a role, a party role or a channel — that the
 * verified context lacks. The recipe is sound; the caller may not run it, so
 * it is `forbidden` rather than a slip that could not be built.
 */
export class FlowRequirementsUnmet extends Failure.forbidden<FlowRequirementsUnmet>()(
  'FlowRequirementsUnmet',
  'flowRequirementsUnmet',
  { violations: Schema.Array(SlipViolationSchema) },
  {
    message: ({ violations }) =>
      `the flow is not offered to this caller: ${violations.map(v => v.detail).join('; ')}`,
  },
) {}

/** Every violation is a requirement the caller lacks, and there is one. */
export const onlyUnmetRequirements = (
  violations: readonly SlipViolation[],
): boolean =>
  violations.length > 0 &&
  violations.every(violation => violation.tag === 'UnmetRequirement');

/**
 * Validates a slip, failing on any violation: with {@link FlowRequirementsUnmet}
 * when the caller lacks only what steps require, and otherwise with
 * {@link CompositionRefused}, which carries every violation.
 */
export const assertValidSlip = (
  slip: Slip,
  catalog: FragmentCatalog,
  options: ValidateSlipOptions = {},
): Effect.Effect<Slip, CompositionRefused | FlowRequirementsUnmet> => {
  const violations = validateSlip(slip, catalog, options);
  if (violations.length === 0) return Effect.succeed(slip);
  return Effect.fail(
    onlyUnmetRequirements(violations)
      ? new FlowRequirementsUnmet({ violations })
      : new CompositionRefused({ violations }),
  );
};
