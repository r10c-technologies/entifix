import type { DomainEvent } from '@entifix/core';

import {
  describePushChannelContract,
  type PushChannelHarness,
} from './push-channel.contract.js';

/**
 * The smallest channel that honours the contract, so the suite's own cases are
 * proven against something before a real adapter runs them.
 */
const makeReferenceHarness = (): PushChannelHarness => {
  const byTopic = new Map<string, Set<(event: DomainEvent) => void>>();
  const connects = new Set<() => void>();
  const resyncs = new Set<(topics: readonly string[]) => void>();
  let connected = false;
  return {
    channel: {
      subscribe(topic, listener) {
        const listeners = byTopic.get(topic) ?? new Set();
        byTopic.set(topic, listeners.add(listener));
        return () => {
          listeners.delete(listener);
          if (listeners.size === 0) byTopic.delete(topic);
        };
      },
      onConnect(listener) {
        connects.add(listener);
        if (connected) listener();
        return () => connects.delete(listener);
      },
      onResync(listener) {
        resyncs.add(listener);
        return () => resyncs.delete(listener);
      },
    },
    settle: () => undefined,
    connect() {
      connected = true;
      for (const listener of connects) listener();
    },
    push(topics, event) {
      const listeners = new Set(
        topics.flatMap(t => [...(byTopic.get(t) ?? [])]),
      );
      for (const listener of listeners) listener(event);
    },
    resync(topics) {
      const still = topics.filter(t => byTopic.has(t));
      if (still.length > 0) for (const listener of resyncs) listener(still);
    },
  };
};

describePushChannelContract('a reference channel', makeReferenceHarness);
