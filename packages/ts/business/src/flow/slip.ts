import { ProtocolFailure } from '@entifix/core';
import { Effect, Schema } from 'effect';

/**
 * The grammar version a slip is written in. An interpreter branches on it, so a
 * flow that started under one grammar finishes under that grammar even after
 * the next one ships.
 */
export const SLIP_VERSION = 1 as const;

const Call = Schema.Struct({
  method: Schema.Literals(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: Schema.String,
});

/** Tags that place a step in a segment of the flow: whose lines, which payment. */
export const SlipSegment = Schema.Struct({
  vendor: Schema.optionalKey(Schema.String),
  paymentMethod: Schema.optionalKey(Schema.String),
});
export type SlipSegment = typeof SlipSegment.Type;

/** One pinned step: a fragment reference and everything resolved for it. */
export const SlipStep = Schema.Struct({
  /** `id@version`, pinned when the slip was composed. */
  ref: Schema.String,
  /** Unique within the slip; what an Activity is named after (`segment:step`). */
  step: Schema.String,
  cardinality: Schema.Literals(['one', 'perVendor', 'perLine']),
  segment: Schema.optionalKey(SlipSegment),
  participant: Schema.optionalKey(Schema.String),
  call: Schema.optionalKey(Call),
  compensation: Schema.optionalKey(Call),
  /** Configuration pinned at composition — a hold's expiry, a limit. */
  parameters: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});
export type SlipStep = typeof SlipStep.Type;

export const SlipStage = Schema.Struct({
  name: Schema.String,
  steps: Schema.Array(SlipStep),
});
export type SlipStage = typeof SlipStage.Type;

/** Which variant each use case resolved to, and by which rule. */
export const SlipResolution = Schema.Struct({
  useCase: Schema.String,
  variant: Schema.String,
  rule: Schema.Number,
});
export type SlipResolution = typeof SlipResolution.Type;

/**
 * A routing slip: ordered stages of pinned steps, composed once at start and
 * stored as the flow's payload. Changing a recipe or a fragment never changes a
 * flow that has already started.
 */
export const Slip = Schema.Struct({
  slipVersion: Schema.Literal(SLIP_VERSION),
  flowId: Schema.String,
  recipe: Schema.String,
  /** The recipe demands a commit point even with no retriable step (a checkout). */
  requiresCommitPoint: Schema.optionalKey(Schema.Boolean),
  stages: Schema.Array(SlipStage),
  resolution: Schema.Array(SlipResolution),
  composedAt: Schema.String,
});
export type Slip = typeof Slip.Type;

/**
 * Decodes a stored or received slip. An unknown `slipVersion`, like any shape
 * the grammar does not describe, is a protocol failure: an interpreter must
 * never guess at a grammar it was not built for.
 */
export const decodeSlip = (
  input: unknown,
): Effect.Effect<Slip, ProtocolFailure> =>
  Schema.decodeUnknownEffect(Slip)(input).pipe(
    Effect.mapError(
      error =>
        new ProtocolFailure({
          reason: `the slip does not decode: ${error.message}`,
        }),
    ),
  );

/** Encodes a slip as the workflow payload it travels as. */
export const encodeSlip = (slip: Slip): unknown =>
  Schema.encodeSync(Slip)(slip);

/** Every step of a slip, in the order it runs. */
export const slipSteps = (slip: Slip): readonly SlipStep[] =>
  slip.stages.flatMap(stage => stage.steps);
