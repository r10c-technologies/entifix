import type { DomainEvent } from '@entifix/core';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  EntifixQueryProvider,
  makeQueryClient,
} from '../query/query-provider.js';
import { makeInMemoryPushChannel, type PushTopic } from './push-channel.js';
import {
  entityRecordQueryKey,
  readReactiveUpdate,
  useReactiveCache,
  type VersionedRecord,
} from './use-reactive-cache.js';

const base = {
  id: 'e-1',
  source: 'catalog',
  at: '2026-11-02T00:00:00.000Z',
};

const snapshot = (version: number, name: string): DomainEvent => ({
  ...base,
  name: 'widget.changed',
  aggregate: { type: 'widget', id: 'w-1' },
  version,
  data: { id: 'w-1', name },
});

const hint: DomainEvent = {
  ...base,
  name: 'transaction.completed',
  data: { entity: 'widget', change: 'updated', id: 'w-1' },
};

const setup = (topics: readonly PushTopic[] = ['entity:widget']) => {
  const client = makeQueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const channel = makeInMemoryPushChannel();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <EntifixQueryProvider client={client}>{children}</EntifixQueryProvider>
  );
  const view = renderHook(
    ({ read }: { read?: typeof readReactiveUpdate }) =>
      useReactiveCache(channel, topics, read === undefined ? {} : { read }),
    { wrapper, initialProps: {} },
  );
  const record = () =>
    client.getQueryData<VersionedRecord>(entityRecordQueryKey('widget', 'w-1'));
  return { client, invalidate, channel, view, record };
};

describe('readReactiveUpdate', () => {
  it('reads an entity change as a hint, a versioned aggregate record as a snapshot, and nothing else', () => {
    expect(readReactiveUpdate(hint)).toEqual({
      kind: 'hint',
      entity: 'widget',
    });
    expect(readReactiveUpdate(snapshot(3, 'a'))).toEqual({
      kind: 'snapshot',
      entity: 'widget',
      id: 'w-1',
      version: 3,
      record: { id: 'w-1', name: 'a' },
    });
    const { version: _, ...unversioned } = snapshot(3, 'a');
    expect(readReactiveUpdate(unversioned)).toBeUndefined();
    expect(
      readReactiveUpdate({ ...snapshot(3, 'a'), data: [1] }),
    ).toBeUndefined();
    expect(
      readReactiveUpdate({ ...snapshot(3, 'a'), data: null }),
    ).toBeUndefined();
  });
});

describe('useReactiveCache', () => {
  it('writes a snapshot into the cache and re-reads the lists, not the record', () => {
    const { channel, invalidate, record } = setup();
    channel.emit(['entity:widget'], snapshot(2, 'two'));

    expect(record()).toEqual({
      version: 2,
      record: { id: 'w-1', name: 'two' },
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    const { predicate } = invalidate.mock.calls[0]?.[0] as {
      predicate: (query: { queryKey: readonly unknown[] }) => boolean;
    };
    expect(predicate({ queryKey: ['entity', 'widget', 'page=1'] })).toBe(true);
    expect(predicate({ queryKey: entityRecordQueryKey('widget', 'w-1') })).toBe(
      false,
    );
  });

  it('never lets an older snapshot overwrite a newer cached record', () => {
    const { channel, invalidate, record } = setup();
    channel.emit(['entity:widget'], snapshot(5, 'five'));
    channel.emit(['entity:widget'], snapshot(4, 'four'));
    channel.emit(['entity:widget'], snapshot(5, 'five again'));

    expect(record()).toEqual({
      version: 5,
      record: { id: 'w-1', name: 'five' },
    });
    expect(invalidate).toHaveBeenCalledTimes(1);

    channel.emit(['entity:widget'], snapshot(6, 'six'));
    expect(record()?.version).toBe(6);
  });

  it('invalidates the entity scope on a hint and ignores what means nothing', () => {
    const { channel, invalidate } = setup();
    channel.emit(['entity:widget'], hint);
    channel.emit(['entity:widget'], { ...hint, data: 'noise' });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['entity', 'widget'] });
  });

  it('reads with the host reader when one is given', () => {
    const { channel, invalidate, view } = setup();
    view.rerender({ read: () => ({ kind: 'hint', entity: 'gadget' }) });
    channel.emit(['entity:widget'], hint);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['entity', 'gadget'] });
  });

  it('invalidates each resynced entity once, and leaves flows and other topics alone', () => {
    const { channel, invalidate } = setup([
      'entity:widget',
      'record:widget:w-1',
      'flow:f-1',
    ]);
    channel.subscribe('entity:other', vi.fn());
    channel.resync([
      'entity:widget',
      'record:widget:w-1',
      'flow:f-1',
      'entity:other',
    ]);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['entity', 'widget'] });
  });

  it('subscribes nothing for no topics, and unsubscribes on unmount', () => {
    const empty = setup([]);
    expect(empty.channel.topics()).toEqual([]);

    const { channel, view, invalidate } = setup();
    expect(channel.topics()).toEqual(['entity:widget']);
    view.unmount();
    expect(channel.topics()).toEqual([]);
    channel.resync(['entity:widget']);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
