import { type DomainEvent, registerEvent } from '@entifix/core';
import type {
  EventBus,
  Subscription,
  TransactionInbox,
} from '@entifix/transactions';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

const run = <TValue, TError>(effect: Effect.Effect<TValue, TError>) =>
  Effect.runPromise(effect);

export interface EventBusContractHarness {
  bus: EventBus;
  /** Delivers `event` to whatever subscribed, as the broker would. */
  deliver(event: DomainEvent): Promise<void>;
  /** Everything the bus published, decoded back into events. */
  published(): DomainEvent[];
}

/** Every subscription in this contract, unless a test says otherwise. */
const ANY_WIDGET_EVENT = 'contract.widget.*';

/**
 * A `work` subscription for `pattern`. The mode and the ceiling are broker
 * facts with no bearing on routing, so a test about routing states them once
 * here rather than repeating them at every call.
 */
const on = (pattern: string): Subscription => ({
  slice: 'contract',
  pattern,
  mode: 'work',
  maxAttempts: 5,
});

/**
 * A handler that records what it is given. Shared by both routing tests so the
 * "nothing was delivered" case asserts on the *same* handler the positive case
 * proves works — otherwise it could pass against a handler that was simply
 * never wired up.
 */
const collectInto = (sink: DomainEvent[]) => (event: DomainEvent) =>
  Effect.sync(() => {
    sink.push(event);
  });

// A transport encodes and decodes through the registry, so the suite's own
// event is registered like any other — audience-free, since nothing here
// delivers to a person.
registerEvent(
  'contract.widget.created',
  Schema.Struct({ entity: Schema.String }),
  { audience: 'none' },
);

const anEvent = (
  id: string,
  name = 'contract.widget.created',
): DomainEvent => ({
  name,
  id,
  source: 'contract-slice',
  at: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  correlationId: id,
  data: { entity: 'contract-widget' },
});

/**
 * What every {@link EventBus} must guarantee: what goes out comes back
 * unchanged, subscribers receive deliveries, and a subscriber receives only what
 * its pattern matches. The transports differ wildly (an array here, a topic
 * exchange in RabbitMQ) — the observable contract does not.
 */
export const describeEventBusContract = (
  name: string,
  makeHarness: () => EventBusContractHarness | Promise<EventBusContractHarness>,
): void => {
  describe(`EventBus contract: ${name}`, () => {
    it('publishes an event verbatim', async () => {
      const harness = await makeHarness();
      const event = anEvent('tx-1');

      await run(harness.bus.publish(event));

      expect(harness.published()).toEqual([event]);
    });

    it('delivers published events to a subscriber', async () => {
      const harness = await makeHarness();
      const received: DomainEvent[] = [];
      await run(
        harness.bus.subscribe(on(ANY_WIDGET_EVENT), collectInto(received)),
      );

      await harness.deliver(anEvent('tx-2'));

      expect(received.map(event => event.id)).toEqual(['tx-2']);
    });

    // Routing is the transport's job. A bus that hands every subscriber every
    // event lets a consumer pass while receiving traffic it never bound to —
    // which is precisely the fault the fanout exchange had.
    it('delivers nothing to a subscriber whose pattern does not match', async () => {
      const harness = await makeHarness();
      const received: DomainEvent[] = [];
      await run(
        harness.bus.subscribe(on('contract.other.*'), collectInto(received)),
      );

      await harness.deliver(anEvent('tx-5'));

      expect(received).toEqual([]);
    });

    it('preserves publication order', async () => {
      const harness = await makeHarness();

      await run(harness.bus.publish(anEvent('tx-3')));
      await run(harness.bus.publish(anEvent('tx-4')));

      expect(harness.published().map(event => event.id)).toEqual([
        'tx-3',
        'tx-4',
      ]);
    });
  });
};

/**
 * What every {@link TransactionInbox} must guarantee: a first claim is granted,
 * every repeat of it is refused, and one consumer's claim says nothing about
 * another's.
 *
 * That last one is the property with teeth. Two consumers legitimately process
 * the same event — the saga tracker's fold and the SSE hub both bind
 * `transaction.*` — so an implementation keyed on `eventId` alone passes the
 * first two cases and silently starves every consumer but the first. It looks
 * like exactly-once from inside one consumer, which is why it is asserted here
 * rather than left to each adapter's own spec.
 */
export const describeTransactionInboxContract = (
  name: string,
  makeInbox: (consumer: string) => TransactionInbox | Promise<TransactionInbox>,
): void => {
  describe(`TransactionInbox contract: ${name}`, () => {
    it('grants a first claim', async () => {
      const inbox = await makeInbox('contract.consumer');

      expect(await run(inbox.claim('tx-1:completed'))).toBe('claimed');
    });

    it('refuses a redelivery of the same event', async () => {
      const inbox = await makeInbox('contract.consumer');
      await run(inbox.claim('tx-2:completed'));

      expect(await run(inbox.claim('tx-2:completed'))).toBe('duplicate');
    });

    it('refuses every repeat, not only the second', async () => {
      const inbox = await makeInbox('contract.consumer');
      await run(inbox.claim('tx-3:completed'));

      expect(await run(inbox.claim('tx-3:completed'))).toBe('duplicate');
      expect(await run(inbox.claim('tx-3:completed'))).toBe('duplicate');
    });

    it('claims each step of one transaction separately', async () => {
      // `<transactionId>:<step>`, never the transaction id alone: one
      // transaction emits up to three messages, and keying on the correlation
      // id would make `completed` read as a redelivery of `accepted`.
      const inbox = await makeInbox('contract.consumer');

      expect(await run(inbox.claim('tx-4:accepted'))).toBe('claimed');
      expect(await run(inbox.claim('tx-4:completed'))).toBe('claimed');
    });

    it('does not let one consumer consume another consumer’s claim', async () => {
      const first = await makeInbox('contract.first');
      const second = await makeInbox('contract.second');
      await run(first.claim('tx-5:completed'));

      expect(await run(second.claim('tx-5:completed'))).toBe('claimed');
    });
  });
};
