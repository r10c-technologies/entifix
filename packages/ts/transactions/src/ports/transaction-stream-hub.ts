import type { DomainEvent, EntityChangeEvent } from '@entifix/core';
import { Context, type Effect, type Stream } from 'effect';

import type { TransactionEvent } from '../contracts/event.js';

/**
 * The in-process fan-out behind `GET /api/transaction/events`.
 *
 * One subscription to the bus feeds it; each connected browser takes its own
 * filtered view. It is a hub rather than a bus subscription per connection
 * because a queue per open tab is a broker resource a client controls.
 */
export interface TransactionStreamHub {
  /** Offer one bus event to every connection scoped to its organization. */
  publish(event: DomainEvent<TransactionEvent>): Effect.Effect<void>;
  /**
   * One connection's view, already scoped and already mapped.
   *
   * ⚠️ **Fails closed.** An event whose `organizationId` does not match is
   * dropped, and so is one carrying none at all — including every event emitted
   * before that member existed. Defaulting an absent organization to "everyone"
   * is a cross-tenant delivery that raises nothing.
   */
  subscribe(
    organizationId: string,
  ): Stream.Stream<DomainEvent<EntityChangeEvent>>;
}

export class TransactionStreamHubTag extends Context.Service<
  TransactionStreamHubTag,
  TransactionStreamHub
>()('TransactionStreamHubTag') {}
