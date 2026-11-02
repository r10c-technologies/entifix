import { makeShutdownRegistry, ShutdownRegistryTag } from '@entifix/business';
import { ProtocolFailure, type StoreFailure, Unavailable } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { OutboxEntry, OutboxEvent } from '../contracts/outbox.js';
import type { Outbox } from '../contracts/outbox.js';
import type { EventBus } from '../ports/event-bus.js';
import {
  drainOutbox,
  type RelayOutcome,
  runRelayDaemon,
  sweepOutbox,
} from './outbox-relay.js';

/** `<aggregate>:<step>`: entries sharing a prefix share an aggregate. */
const anEvent = (id: string): OutboxEvent => ({
  name: 'transaction.accepted',
  id,
  source: 'marketplace-admin',
  at: '2026-01-01T00:00:00.000Z',
  correlationId: id.split(':')[0] ?? id,
  aggregate: { type: 'transaction', id: id.split(':')[0] ?? id },
  version: 0,
  data: {},
});

const anEntry = (id: string, attempts = 0): OutboxEntry => ({
  eventId: id,
  aggregate: anEvent(id).aggregate,
  version: anEvent(id).version,
  event: anEvent(id),
  sent: false,
  attempts,
  quarantined: false,
  createdAt: '2026-01-01T00:00:00.000Z',
});

/**
 * An outbox that records what the relay did to it. `pending` deliberately
 * returns the same batch every call — the relay drains once per invocation, so
 * a spec asserts on the recorded calls rather than on a second pass.
 */
const recordingOutbox = (entries: readonly OutboxEntry[]) => {
  const sent: string[] = [];
  const failures: Array<{
    eventId: string;
    error: string;
    quarantine: boolean;
  }> = [];

  const outbox: Outbox = {
    enqueue: () => Effect.succeed('enqueued' as const),
    pending: () => Effect.succeed(entries),
    markSent: entry =>
      Effect.sync(() => {
        sent.push(entry.eventId);
      }),
    recordFailure: (entry, error, quarantine) =>
      Effect.sync(() => {
        failures.push({ eventId: entry.eventId, error, quarantine });
      }),
    stats: () =>
      Effect.succeed({
        pending: entries.filter(entry => !entry.quarantined).length,
        quarantined: entries.filter(entry => entry.quarantined).length,
        oldestPendingAt: entries.find(entry => !entry.quarantined)?.createdAt,
      }),
  };

  return { outbox, sent, failures };
};

/** A bus that refuses the named events and accepts everything else. */
const busRefusing = (
  unpublishable: readonly string[],
  failure: StoreFailure = new ProtocolFailure({
    reason: 'routing key too long',
  }),
) => {
  const published: string[] = [];

  const bus: EventBus = {
    publish: event =>
      unpublishable.includes(event.id)
        ? Effect.fail(failure)
        : Effect.sync(() => {
            published.push(event.id);
          }),
    subscribe: () => Effect.void,
  };

  return { bus, published };
};

const OPTIONS = { maxAttempts: 3, database: 'tenant_acme' };

/** Runs the drain and returns its result plus the outcomes it reported. */
const runDrain = async (outbox: Outbox, bus: EventBus, options = OPTIONS) => {
  const outcomes: RelayOutcome[] = [];
  const sent = await Effect.runPromise(
    drainOutbox(outbox, bus, {
      ...options,
      onOutcome: outcome => Effect.sync(() => void outcomes.push(outcome)),
    }),
  );
  return { sent, outcomes };
};
describe('drainOutbox', () => {
  it('publishes pending entries oldest-first and marks each sent', async () => {
    const { outbox, sent } = recordingOutbox([
      anEntry('tx-1:accepted'),
      anEntry('tx-1:completed'),
    ]);
    const { bus, published } = busRefusing([]);

    const result = await runDrain(outbox, bus);

    expect(result.sent).toBe(2);
    expect(published).toEqual(['tx-1:accepted', 'tx-1:completed']);
    expect(sent).toEqual(['tx-1:accepted', 'tx-1:completed']);
  });

  /**
   * The ordering guarantee that predates quarantine and still holds: a broker
   * outage must not let `completed` overtake its own `accepted`.
   */
  it('stops at a failure it may still retry, leaving the order intact', async () => {
    const { outbox, sent, failures } = recordingOutbox([
      anEntry('tx-1:accepted'),
      anEntry('tx-1:completed'),
    ]);
    const { bus, published } = busRefusing(['tx-1:accepted']);

    const result = await runDrain(outbox, bus);

    expect(result.sent).toBe(0);
    // The entry behind the failure is untouched — that is the whole point.
    expect(published).toEqual([]);
    expect(sent).toEqual([]);
    expect(failures).toEqual([
      {
        eventId: 'tx-1:accepted',
        error: 'routing key too long',
        quarantine: false,
      },
    ]);
  });

  it('records the code when the failure carries no message', async () => {
    const { outbox, failures } = recordingOutbox([anEntry('tx-1:accepted')]);
    const { bus } = busRefusing(['tx-1:accepted'], new Unavailable({}));

    await runDrain(outbox, bus);

    expect(failures[0]?.error).toBe('unavailable');
  });

  /**
   * The defect quarantine exists for: before it, an entry that could never publish
   * held its tenant's outbox head-of-line forever, with nothing to look at.
   */
  it('quarantines an entry at the ceiling and lets the queue move past it', async () => {
    const { outbox, sent, failures } = recordingOutbox([
      // Two attempts already spent; this failure is the third.
      anEntry('tx-1:accepted', 2),
      anEntry('tx-2:accepted'),
    ]);
    const { bus, published } = busRefusing(['tx-1:accepted']);

    const result = await runDrain(outbox, bus);

    expect(failures).toEqual([
      {
        eventId: 'tx-1:accepted',
        error: 'routing key too long',
        quarantine: true,
      },
    ]);
    // The head moved: the entry behind the quarantined one was delivered.
    expect(published).toEqual(['tx-2:accepted']);
    expect(sent).toEqual(['tx-2:accepted']);
    expect(result.sent).toBe(1);
  });

  /**
   * The outbox's metrics count these, and the log names each one — together
   * they are what "visible without a mongosh session" means, and a quarantined
   * entry nobody can see is indistinguishable from a dropped one.
   */
  it('reports the quarantine with the tenant, the code and the reason', async () => {
    const { outbox } = recordingOutbox([anEntry('tx-1:accepted', 2)]);
    const { bus } = busRefusing(['tx-1:accepted']);

    const { outcomes } = await runDrain(outbox, bus);

    expect(outcomes).toEqual([
      {
        _tag: 'quarantined',
        // Fields, not a rendered string, so the host's log line says *which*
        // tenant is stuck and an operator needs no mongosh session to find it.
        database: 'tenant_acme',
        eventId: 'tx-1:accepted',
        eventName: 'transaction.accepted',
        attempts: 3,
        code: 'protocol',
        reason: 'routing key too long',
      },
      { _tag: 'drained', database: 'tenant_acme', sent: 0 },
    ]);
  });

  it('quarantines quietly when nobody listens', async () => {
    const { outbox, failures } = recordingOutbox([anEntry('tx-1:accepted', 2)]);
    const { bus } = busRefusing(['tx-1:accepted']);

    await Effect.runPromise(drainOutbox(outbox, bus, OPTIONS));

    expect(failures[0]?.quarantine).toBe(true);
  });

  it('does not quarantine before the ceiling is actually reached', async () => {
    const { outbox, failures } = recordingOutbox([anEntry('tx-1:accepted', 1)]);
    const { bus } = busRefusing(['tx-1:accepted']);

    await runDrain(outbox, bus);

    // Second of three attempts: still retrying, so nothing is written off.
    expect(failures[0]?.quarantine).toBe(false);
  });
});

describe('sweepOutbox', () => {
  /**
   * ⚠️ **After the drain, not before.** A sample taken first reports what was
   * waiting a moment before this pass cleared it, which is a gauge that reads
   * healthy exactly when the relay has just fallen behind.
   */
  it('samples the depth after draining', async () => {
    const { outbox } = recordingOutbox([anEntry('a'), anEntry('b')]);
    const { bus } = busRefusing([]);
    const sampled: Array<{ database: string; pending: number }> = [];

    await Effect.runPromise(
      sweepOutbox(outbox, bus, {
        maxAttempts: 3,
        database: 'order',
        onStats: (database, stats) =>
          Effect.sync(() => {
            sampled.push({ database, pending: stats.pending });
          }),
      }),
    );

    expect(sampled).toEqual([{ database: 'order', pending: 2 }]);
  });

  /**
   * ⚠️ This runs inside `Effect.forever`. An error that escapes ends the daemon
   * silently, and a relay that stopped is indistinguishable from a relay with
   * nothing to do — so the failure is caught, and *logged* rather than
   * swallowed.
   */
  it('reports a failed pass rather than ending the daemon', async () => {
    const failing: Outbox = {
      enqueue: () => Effect.succeed('enqueued' as const),
      pending: () => Effect.fail(new Unavailable({})),
      markSent: () => Effect.void,
      recordFailure: () => Effect.void,
      stats: () => Effect.succeed({ pending: 0, quarantined: 0 }),
    };
    const { bus } = busRefusing([]);
    const outcomes: RelayOutcome[] = [];

    await Effect.runPromise(
      sweepOutbox(failing, bus, {
        maxAttempts: 3,
        database: 'order',
        onOutcome: outcome => Effect.sync(() => void outcomes.push(outcome)),
      }),
    );

    expect(outcomes).toEqual([
      {
        _tag: 'sweepFailed',
        database: 'order',
        failure: expect.objectContaining({ _tag: 'Unavailable' }),
      },
    ]);
    // And with nobody listening, it still swallows the failure.
    await expect(
      Effect.runPromise(
        sweepOutbox(failing, bus, { maxAttempts: 3, database: 'order' }),
      ),
    ).resolves.toBeUndefined();
  });

  it('records through the default sink when none is given', async () => {
    const { outbox, sent } = recordingOutbox([anEntry('a')]);
    const { bus } = busRefusing([]);

    // No `onStats`: the default is the exported gauge recorder, which must be
    // reached rather than skipped — an outbox whose depth nothing reports is
    // the failure the gauges exist to make visible.
    await Effect.runPromise(
      sweepOutbox(outbox, bus, { maxAttempts: 3, database: 'order' }),
    );

    expect(sent).toEqual(['a']);
  });
});

describe('runRelayDaemon', () => {
  it('registers a flush that stops the daemon and runs one last sweep', async () => {
    const hooks: Array<{
      name: string;
      phase: string;
      run: Effect.Effect<void>;
    }> = [];
    let sweeps = 0;
    const registry = {
      ...makeShutdownRegistry().registry,
      register: (hook: {
        name: string;
        phase: string;
        run: Effect.Effect<void>;
      }) =>
        Effect.sync(() => {
          hooks.push(hook);
        }),
    };

    await Effect.runPromise(
      runRelayDaemon(
        Effect.sync(() => {
          sweeps += 1;
        }),
      ).pipe(Effect.provideService(ShutdownRegistryTag, registry as never)),
    );
    await Effect.runPromise(hooks[0]?.run ?? Effect.void);

    expect(hooks.map(({ name, phase }) => ({ name, phase }))).toEqual([
      { name: 'outbox-relay', phase: 'flush' },
    ]);
    expect(sweeps).toBe(1);
  });
});
