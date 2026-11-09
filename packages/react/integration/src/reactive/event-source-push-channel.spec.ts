import {
  describePushChannelContract,
  pushChannelContractEvent,
} from '@entifix/testing-unit/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type EventSourcePushChannelOptions,
  makeEventSourcePushChannel,
} from './event-source-push-channel.js';
import {
  latest,
  useFakePushEventSource,
} from './spec-support/fake-push-event-source.js';

const URL = '/api/push';

const make = (options: Partial<EventSourcePushChannelOptions> = {}) =>
  makeEventSourcePushChannel({
    url: URL,
    refresh: () => Promise.resolve(),
    ...options,
  });

const settle = () => vi.advanceTimersByTime(25);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describePushChannelContract('makeEventSourcePushChannel', () => {
  useFakePushEventSource();
  const channel = make();
  return {
    channel,
    settle,
    connect: () => latest().open(),
    push: (topics, event) => latest().event(topics, event),
    resync: topics => latest().named('resync', JSON.stringify({ topics })),
    drop: state => latest().fail(state),
  };
});

describe('makeEventSourcePushChannel', () => {
  it('opens one EventSource for three topics, and reopens it once for a fourth with the last event id', () => {
    const sources = useFakePushEventSource();
    const channel = make();
    channel.subscribe('entity:a', vi.fn());
    channel.subscribe('record:a:1', vi.fn());
    channel.subscribe('flow:f-1', vi.fn());
    settle();

    expect(sources).toHaveLength(1);
    expect(latest().url).toBe(
      '/api/push?topic=entity%3Aa&topic=flow%3Af-1&topic=record%3Aa%3A1',
    );

    latest().open();
    latest().event(['entity:a'], pushChannelContractEvent('e-7'));
    channel.subscribe('entity:b', vi.fn());
    channel.subscribe('entity:b', vi.fn());
    settle();

    expect(sources).toHaveLength(2);
    expect(sources[0]?.closed).toBe(true);
    expect(latest().url).toBe(
      '/api/push?topic=entity%3Aa&topic=entity%3Ab&topic=flow%3Af-1&topic=record%3Aa%3A1&lastEventId=e-7',
    );
  });

  it('does not reopen when the topics did not change, and closes when nobody listens', () => {
    const sources = useFakePushEventSource();
    const channel = make();
    const stop = channel.subscribe('entity:a', vi.fn());
    settle();
    stop();
    const again = channel.subscribe('entity:a', vi.fn());
    settle();
    expect(sources).toHaveLength(1);
    expect(latest().closed).toBe(false);

    again();
    settle();
    expect(sources).toHaveLength(1);
    expect(latest().closed).toBe(true);
  });

  it('presents the host capabilities, sorted, on a URL that already has a query', () => {
    useFakePushEventSource();
    const channel = make({
      url: '/api/push?v=1',
      capabilities: () => ['cap-b', 'cap-a'],
    });
    channel.subscribe('flow:f-1', vi.fn());
    settle();
    expect(latest().url).toBe(
      '/api/push?v=1&topic=flow%3Af-1&capability=cap-a&capability=cap-b',
    );
  });

  it('keeps the last event id when a frame carries none', () => {
    useFakePushEventSource();
    const channel = make();
    channel.subscribe('entity:a', vi.fn());
    settle();
    latest().event(['entity:a'], pushChannelContractEvent('e-1'));
    latest().message('not json');
    channel.subscribe('entity:b', vi.fn());
    settle();
    expect(latest().url).toContain('&lastEventId=e-1');
  });

  it('refreshes on reauth before opening a new EventSource, and never while the refresh is pending', async () => {
    const sources = useFakePushEventSource();
    let finish = (): void => undefined;
    const refresh = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        }),
    );
    const channel = make({ refresh });
    channel.subscribe('entity:a', vi.fn());
    settle();
    latest().open();

    latest().named('reauth', '{}');
    expect(sources[0]?.closed).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);

    channel.subscribe('entity:b', vi.fn());
    settle();
    expect(sources).toHaveLength(1);

    finish();
    await vi.runAllTimersAsync();
    expect(sources).toHaveLength(2);
    expect(latest().url).toBe('/api/push?topic=entity%3Aa&topic=entity%3Ab');
  });

  it('stays closed when the refresh fails, until interest next changes', async () => {
    const sources = useFakePushEventSource();
    const channel = make({ refresh: () => Promise.reject(new Error('gone')) });
    channel.subscribe('entity:a', vi.fn());
    settle();
    latest().named('reauth', '{}');
    await vi.runAllTimersAsync();
    expect(sources).toHaveLength(1);

    channel.subscribe('entity:b', vi.fn());
    settle();
    expect(sources).toHaveLength(2);
  });

  it('does not hear of a connection again until the new stream opens', () => {
    useFakePushEventSource();
    const channel = make();
    channel.subscribe('entity:a', vi.fn());
    settle();
    latest().open();
    channel.subscribe('entity:b', vi.fn());
    settle();

    const listener = vi.fn();
    channel.onConnect(listener);
    expect(listener).not.toHaveBeenCalled();
    latest().open();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a frame that is not JSON', 'not json'],
    ['a frame without topics', '{"envelope":{}}'],
    [
      'an envelope that is not a registered event',
      '{"topics":["entity:a"],"envelope":{"meta":{"type":"event","event":{"name":"nobody.registered","id":"1","source":"s","at":"t"}},"data":{}}}',
    ],
  ])('drops and counts %s', (_label, frame) => {
    useFakePushEventSource();
    const channel = make();
    const listener = vi.fn();
    channel.subscribe('entity:a', listener);
    settle();
    expect(() => latest().message(frame)).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
    expect(channel.dropped()).toBe(1);
  });

  it('drops and counts a resync that does not decode', () => {
    useFakePushEventSource();
    const channel = make();
    const listener = vi.fn();
    channel.onResync(listener);
    channel.subscribe('entity:a', vi.fn());
    settle();
    latest().named('resync', '{"topics":"entity:a"}');
    expect(listener).not.toHaveBeenCalled();
    expect(channel.dropped()).toBe(1);
  });

  it('opens nothing where there is no EventSource, as on a server render', () => {
    const channel = make();
    channel.subscribe('entity:a', vi.fn());
    expect(() => settle()).not.toThrow();
  });
});
