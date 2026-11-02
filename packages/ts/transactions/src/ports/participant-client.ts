import type { SlipStep } from '@entifix/business/flow';
import type { EntifixFailure } from '@entifix/core';
import { Context, type Effect } from 'effect';

/** One call a flow makes to a participant, for a step or for its undoing. */
export interface ParticipantCall {
  readonly step: SlipStep;
  /** `action` runs the step's call, `compensation` the call that undoes it. */
  readonly kind: 'action' | 'compensation';
  /**
   * `<flowId>:<step>`, with `:compensation` for an undoing — the participant's
   * `Idempotency-Key`, stable across every redelivery and resume.
   */
  readonly idempotencyKey: string;
  /** What earlier steps answered, by step — the inputs a step may name. */
  readonly outputs: Readonly<Record<string, unknown>>;
}

/**
 * How a flow reaches its participants
 * ([ADR 0016](../../../../../docs/adr/0016-a-flow-engine-port-and-a-durable-workflow-adapter.md)).
 * The interpreter calls this and nothing else, so the transport — HTTP with a
 * crossing token, or an in-process double — is the composition root's choice.
 * A refusal is the participant's typed failure; anything that kept the call
 * from being answered is a technical one.
 */
export interface ParticipantClient {
  readonly call: (
    request: ParticipantCall,
  ) => Effect.Effect<unknown, EntifixFailure>;
}

export class ParticipantClientTag extends Context.Service<
  ParticipantClientTag,
  ParticipantClient
>()('@entifix/transactions/ParticipantClient') {}
