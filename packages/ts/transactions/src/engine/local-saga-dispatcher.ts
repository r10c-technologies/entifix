import { type EntifixConnError, EntifixLogicError } from '@entifix/core';
import { Effect, Layer } from 'effect';

import type { SagaCall } from '../contracts/saga-definition.js';
import {
  type SagaDispatch,
  type SagaDispatcher,
  SagaDispatcherTag,
  type SagaResponse,
} from '../ports/saga-dispatcher.js';

/** What a local participant is handed: the dispatch, minus whom it is for. */
export type LocalSagaRequest = Omit<SagaDispatch, 'participant'>;

/**
 * One participant answered in-process.
 *
 * The same contract an HTTP participant keeps: a business refusal is a response
 * with `ok: false` — the engine compensates on it — and only a failure to reach
 * the participant at all is an {@link EntifixConnError}. Key the side effect on
 * `commandId` (an inbox), because a resumed flow dispatches the same command
 * again.
 */
export type LocalSagaParticipant = (
  request: LocalSagaRequest,
) => Effect.Effect<SagaResponse, EntifixConnError>;

/**
 * A {@link SagaDispatcher} that calls participants in this process.
 *
 * The saga engine never does HTTP itself: a step is a `{ method, path }` handed
 * to the dispatcher port. So a flow whose every step belongs to one service needs
 * no transport, no crossing token and no second process — only this, with each
 * participant name mapped to the Effect that performs its commands. A handler
 * that serves several commands routes on `request.call`.
 *
 * ⚠️ A participant the definition names and this map lacks is a **defect**, not
 * a failed step: it is a wiring mistake the flow cannot recover from, and
 * reporting it as a refusal would compensate a flow for a bug.
 */
export const makeLocalSagaDispatcher = (
  participants: Readonly<Record<string, LocalSagaParticipant>>,
): SagaDispatcher => ({
  dispatch: ({ participant, ...request }) => {
    const handle = participants[participant];
    return handle === undefined
      ? Effect.die(
          new EntifixLogicError(
            `The saga dispatched to participant "${participant}", which this service registered no local handler for.`,
            undefined,
            { participant, call: request.call },
          ),
        )
      : handle(request);
  },
});

/** Provides {@link SagaDispatcherTag} from local participants. */
export const LocalSagaDispatcherLayer = (
  participants: Readonly<Record<string, LocalSagaParticipant>>,
): Layer.Layer<SagaDispatcherTag> =>
  Layer.succeed(SagaDispatcherTag, makeLocalSagaDispatcher(participants));

/** True when a request is the given command, for a participant routing on it. */
export const isSagaCall = (
  request: LocalSagaRequest,
  call: SagaCall,
): boolean =>
  request.call.method === call.method && request.call.path === call.path;
