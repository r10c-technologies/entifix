import type { DomainEvent } from '@entifix/core';
import type { FlowStatusBody } from '@entifix/transactions';
import { renderHook, waitFor } from '@testing-library/react';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { makeInMemoryPushChannel } from '../reactive/push-channel.js';
import {
  makePendingFlowStore,
  type PendingFlowStorage,
} from './pending-flow-store.js';
import {
  type FlowStatusRead,
  usePendingFlowSettlement,
} from './use-pending-flow-settlement.js';

const CREATED = Date.parse('2026-11-02T10:00:00.000Z');
const MAX_AGE = 60_000;

const flowEvent = (
  name: string,
  flowId: string,
  failure?: { code: string; category: string },
): DomainEvent => ({
  name,
  id: `${flowId}:${name}`,
  source: 'checkout',
  at: '2026-11-02T10:00:01.000Z',
  correlationId: flowId,
  data: {
    flowId,
    definition: 'checkout',
    slipVersion: 1,
    ...(failure === undefined ? {} : { failure }),
  },
});

const declined = { code: 'declined', category: 'declined' };

const setup = ({
  readStatus,
  now = CREATED + 1_000,
  storage,
}: {
  readStatus?: FlowStatusRead;
  now?: number;
  storage?: PendingFlowStorage;
} = {}) => {
  const channel = makeInMemoryPushChannel();
  const store = makePendingFlowStore({
    now: () => new Date(CREATED),
    ...(storage === undefined ? {} : { storage }),
  });
  const onFailure = vi.fn();
  const onConfirmed = vi.fn();
  const view = renderHook(() =>
    usePendingFlowSettlement({
      channel,
      store,
      maxAgeMs: MAX_AGE,
      now: () => now,
      onFailure,
      onConfirmed,
      ...(readStatus === undefined ? {} : { readStatus }),
    }),
  );
  return { channel, store, onFailure, onConfirmed, view };
};

const status =
  (answers: Record<string, FlowStatusBody | undefined | 'unreachable'>) =>
  (href: string) => {
    const answer = answers[href];
    return answer === 'unreachable'
      ? Effect.fail(new Error('unreachable'))
      : Effect.succeed(answer);
  };

describe('usePendingFlowSettlement', () => {
  it('subscribes each pending flow, and confirms one on flow.completed', async () => {
    const { channel, store, onConfirmed } = setup();
    store.add({ flowId: 'f-1' });
    await waitFor(() => expect(channel.topics()).toEqual(['flow:f-1']));

    channel.emit(['flow:f-1'], flowEvent('flow.started', 'f-1'));
    expect(store.list()).toHaveLength(1);
    channel.emit(['flow:f-1'], flowEvent('flow.completed', 'f-1'));

    expect(store.list()).toEqual([]);
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(channel.topics()).toEqual([]));
  });

  it('fails a flow on flow.failed with exactly one toast, carrying the decoded failure', async () => {
    const { channel, store, onFailure } = setup();
    store.add({ flowId: 'f-1' });
    await waitFor(() => expect(channel.topics()).toEqual(['flow:f-1']));

    channel.emit(['flow:f-1'], {
      ...flowEvent('flow.failed', 'f-1'),
      data: 'x',
    });
    expect(store.list()).toHaveLength(1);

    const failed = flowEvent('flow.failed', 'f-1', declined);
    channel.emit(['flow:f-1'], failed);
    channel.emit(['flow:f-1'], failed);

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0]?.[0]).toMatchObject({
      _tag: 'Declined',
      code: 'declined',
    });
    expect(onFailure.mock.calls[0]?.[1]).toMatchObject({ flowId: 'f-1' });
  });

  it('names an internal failure for a flow that failed without saying why', async () => {
    const { channel, store, onFailure } = setup();
    store.add({ flowId: 'f-1' });
    await waitFor(() => expect(channel.topics()).toEqual(['flow:f-1']));
    channel.emit(['flow:f-1'], flowEvent('flow.failed', 'f-1'));
    expect(onFailure.mock.calls[0]?.[0]).toMatchObject({ _tag: 'Internal' });
  });

  it('settles on catch-up when the push was missed', async () => {
    const { channel, store, onConfirmed, onFailure } = setup({
      readStatus: status({
        '/f/done': { flowId: 'done', state: 'completed' },
        '/f/declined': {
          flowId: 'declined',
          state: 'failed',
          failure: declined,
        },
        '/f/undone': { flowId: 'undone', state: 'compensated' },
        '/f/stopped': { flowId: 'stopped', state: 'interrupted' },
        '/f/running': { flowId: 'running', state: 'running' },
        '/f/young': undefined,
        '/f/down': 'unreachable',
      }),
    });
    for (const id of [
      'done',
      'declined',
      'undone',
      'stopped',
      'running',
      'young',
      'down',
    ])
      store.add({ flowId: id, status: `/f/${id}` });

    channel.connect();

    await waitFor(() =>
      expect(store.list().map(flow => flow.flowId)).toEqual([
        'running',
        'young',
        'down',
      ]),
    );
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls.map(([failure]) => failure._tag)).toEqual([
      'Declined',
      'Internal',
      'Internal',
    ]);
  });

  it('drops a flow nobody can account for past the age bound, with no toast', async () => {
    const { channel, store, onFailure } = setup({
      now: CREATED + MAX_AGE + 1,
      readStatus: status({ '/f/lost': undefined }),
    });
    store.add({ flowId: 'lost', status: '/f/lost' });
    store.add({ flowId: 'linkless' });

    channel.connect();

    await waitFor(() => expect(store.list()).toEqual([]));
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('settles by push alone without a status reader, and drops only what aged out', async () => {
    const young = setup();
    young.store.add({ flowId: 'f-1', status: '/f/f-1' });
    young.channel.connect();
    await young.store.ready;
    expect(young.store.list()).toHaveLength(1);

    const old = setup({ now: CREATED + MAX_AGE + 1 });
    old.store.add({ flowId: 'f-1', status: '/f/f-1' });
    old.channel.connect();
    await waitFor(() => expect(old.store.list()).toEqual([]));
  });

  it('re-reads only the flows a resync names', async () => {
    const readStatus = vi.fn(
      status({ '/f/a': { flowId: 'a', state: 'completed' } }),
    );
    const { channel, store } = setup({ readStatus });
    store.add({ flowId: 'a', status: '/f/a' });
    store.add({ flowId: 'b', status: '/f/b' });
    await waitFor(() => expect(channel.topics()).toHaveLength(2));

    channel.resync(['flow:a', 'flow:b']);
    await waitFor(() =>
      expect(store.list().map(flow => flow.flowId)).toEqual(['b']),
    );
    channel.resync(['flow:b']);

    expect(readStatus.mock.calls.map(([href]) => href)).toEqual([
      '/f/a',
      '/f/b',
      '/f/b',
    ]);
  });

  it('settles a flow persisted before a reload, on catch-up', async () => {
    const items = new Map<string, string>();
    const storage: PendingFlowStorage = {
      getItem: name => items.get(name) ?? null,
      setItem: (name, value) => {
        items.set(name, value);
      },
    };
    const before = makePendingFlowStore({
      storage,
      now: () => new Date(CREATED),
    });
    before.add({ flowId: 'f-1', status: '/f/f-1' });
    await new Promise(resolve => setTimeout(resolve, 0));

    const { channel, store, onConfirmed } = setup({
      storage,
      readStatus: status({ '/f/f-1': { flowId: 'f-1', state: 'completed' } }),
    });
    channel.connect();

    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    expect(store.list()).toEqual([]);
  });

  it('lets go of the channel on unmount', async () => {
    const { channel, store, view } = setup({
      readStatus: status({ '/f/f-1': { flowId: 'f-1', state: 'completed' } }),
    });
    store.add({ flowId: 'f-1', status: '/f/f-1' });
    await waitFor(() => expect(channel.topics()).toEqual(['flow:f-1']));
    view.unmount();

    expect(channel.topics()).toEqual([]);
    channel.connect();
    channel.resync(['flow:f-1']);
    await store.ready;
    expect(store.list()).toHaveLength(1);
  });
});
