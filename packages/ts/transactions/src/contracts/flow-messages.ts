import {
  type AudienceEntry,
  type DomainEvent,
  openStruct,
  registerEvent,
  registerMessage,
} from '@entifix/core';
import { Schema } from 'effect';

/** The four things a flow announces about itself. */
export const FLOW_EVENTS = [
  'flow.started',
  'flow.completed',
  'flow.failed',
  'flow.suspended',
] as const;
export type FlowEventName = (typeof FLOW_EVENTS)[number];

/** A failure inside an asynchronous message: the problem's code and category. */
const FlowFailure = openStruct({
  code: Schema.NonEmptyString,
  category: Schema.NonEmptyString,
});

/**
 * What a `flow.*` event carries. A `flow.failed` without a failure, or with a
 * failure missing its `code` or `category`, does not decode: a client settling
 * a write must be able to translate why it failed.
 */
export const FlowEventData = Schema.Struct({
  flowId: Schema.String,
  definition: Schema.String,
  slipVersion: Schema.Number,
  step: Schema.optionalKey(Schema.String),
  outcome: Schema.optionalKey(Schema.Unknown),
  failure: Schema.optionalKey(FlowFailure),
});
export type FlowEventData = typeof FlowEventData.Type;

const FlowFailedData = Schema.Struct({
  ...FlowEventData.fields,
  failure: FlowFailure,
});

for (const name of FLOW_EVENTS)
  registerEvent(name, name === 'flow.failed' ? FlowFailedData : FlowEventData, {
    versioned: true,
  });

/**
 * The `202` body a flow start answers: the flow's id, and where to watch it —
 * its status read and its stream.
 */
export const FlowAccepted = Schema.Struct({
  flowId: Schema.String,
  links: Schema.Array(
    Schema.Struct({
      rel: Schema.Literals(['status', 'stream']),
      href: Schema.String,
    }),
  ),
});
export type FlowAccepted = typeof FlowAccepted.Type;

registerMessage('flowAccepted', FlowAccepted);

export interface FlowEventInput {
  readonly name: FlowEventName;
  readonly source: string;
  readonly at: string;
  /** The step this event is about, and its ordinal — the event's version. */
  readonly step: string;
  readonly ordinal: number;
  readonly audience: readonly AudienceEntry[];
  readonly data: FlowEventData;
}

/**
 * Builds a `flow.*` event: id `<flowId>:<step>` so a redelivered announce is
 * the same message, `correlationId` the flow, the step ordinal as version, and
 * an audience that must not be empty.
 */
export const flowEvent = (
  input: FlowEventInput,
): DomainEvent<FlowEventData> => ({
  name: input.name,
  id: `${input.data.flowId}:${input.step}`,
  source: input.source,
  at: input.at,
  correlationId: input.data.flowId,
  version: input.ordinal,
  audience: input.audience,
  data: input.data,
});
