// Loaded for its registration of `flowAccepted`, which the decode below reads.
import '@entifix/transactions';

import {
  decodeEnvelope,
  pending,
  type ProtocolFailure,
  settled,
  type WriteResult,
} from '@entifix/core';
import type { FlowAccepted } from '@entifix/transactions';
import { Effect } from 'effect';

import type { HttpResponse } from '../../clients/types.js';

/**
 * Reads a write's answer as one of its two modes
 * ([ADR 0022](../../../../../../docs/adr/0022-two-settle-modes-and-the-pending-flow-store.md)):
 * a `202` is a flow, and its body must decode as `flowAccepted`; any other
 * success is the write itself, read by `readSettled`. A failure status never
 * gets here — the fetch client already decoded it as the failure it is.
 */
export const readWriteResponse = <T, E>(
  response: HttpResponse<unknown>,
  readSettled: (body: unknown) => Effect.Effect<T, E>,
): Effect.Effect<WriteResult<T>, E | ProtocolFailure> =>
  response.status === 202
    ? Effect.map(decodeEnvelope(response.body, 'flowAccepted'), envelope => {
        // Decoded against the registered `flowAccepted` schema just above.
        const accepted = envelope.data as FlowAccepted;
        return pending(accepted.flowId, accepted.links);
      })
    : Effect.map(readSettled(response.body), value => settled(value));
