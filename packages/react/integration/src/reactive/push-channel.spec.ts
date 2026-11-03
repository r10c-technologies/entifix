import { describePushChannelContract } from '@entifix/testing-unit/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  entityTopic,
  flowTopic,
  makeInMemoryPushChannel,
  NoopPushChannel,
  type PushTopic,
  recordTopic,
} from './push-channel.js';

describePushChannelContract('makeInMemoryPushChannel', () => {
  const channel = makeInMemoryPushChannel();
  return {
    channel,
    settle: () => undefined,
    connect: () => channel.connect(),
    push: (topics, event) => channel.emit(topics as PushTopic[], event),
    resync: topics => channel.resync(topics as PushTopic[]),
  };
});

describe('push topics', () => {
  it('spells the three topic kinds', () => {
    expect(entityTopic('widget')).toBe('entity:widget');
    expect(recordTopic('widget', 7)).toBe('record:widget:7');
    expect(flowTopic('f-1')).toBe('flow:f-1');
  });
});

describe('makeInMemoryPushChannel', () => {
  it('lists the subscribed topics, sorted, and forgets one nobody holds', () => {
    const channel = makeInMemoryPushChannel();
    const stop = channel.subscribe('entity:b', vi.fn());
    channel.subscribe('entity:a', vi.fn());
    expect(channel.topics()).toEqual(['entity:a', 'entity:b']);
    stop();
    expect(channel.topics()).toEqual(['entity:a']);
  });
});

describe('NoopPushChannel', () => {
  it('never connects, emits or resyncs', () => {
    const listener = vi.fn();
    NoopPushChannel.subscribe('entity:x', listener)();
    NoopPushChannel.onConnect(listener)();
    NoopPushChannel.onResync(listener)();
    expect(listener).not.toHaveBeenCalled();
  });
});
