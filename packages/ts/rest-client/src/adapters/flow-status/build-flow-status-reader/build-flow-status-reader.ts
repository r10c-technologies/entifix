// Loaded for its registration of `flowStatus`, which the decode below reads.
import '@entifix/transactions';

import { decodeEnvelope, type TransitionalFailure } from '@entifix/core';
import type { FlowStatusBody } from '@entifix/transactions';
import { Effect } from 'effect';

import { performHttpRequestThroughFetch } from '../../../clients/fetch/index.js';
import { isNotFound } from '../../is-not-found.js';

/** Reads where a flow stands from the `status` link its `202` named. */
export type FlowStatusReader = (
  href: string,
) => Effect.Effect<FlowStatusBody | undefined, TransitionalFailure>;

/**
 * Reads a flow's `status` link over HTTP, for a browser settling a write whose
 * outcome it did not hear pushed.
 *
 * ⚠️ **A `404` answers `undefined`, and that is not a failure.** A status read
 * is a projection of the flow's events, so a flow that has just started may
 * not be in it yet; the caller keeps the write pending, up to its own bound
 * ([ADR 0022](../../../../../../docs/adr/0022-two-settle-modes-and-the-pending-flow-store.md)).
 * Every other failure stays a failure, so an unreachable service is not read
 * as "no such flow".
 */
export const buildFlowStatusReader = (): FlowStatusReader => (href: string) =>
  Effect.gen(function* () {
    const response = yield* performHttpRequestThroughFetch({
      method: 'GET',
      url: href,
    });
    const envelope = yield* decodeEnvelope(response.body, 'flowStatus');
    // Decoded against the registered `flowStatus` schema just above.
    return envelope.data as FlowStatusBody;
  }).pipe(
    Effect.catch(error =>
      isNotFound(error) ? Effect.succeed(undefined) : Effect.fail(error),
    ),
  );
