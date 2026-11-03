import {
  Declined,
  type DomainEvent,
  pending,
  settled,
  type WriteResult,
} from '@entifix/core';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Effect } from 'effect';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  EntifixQueryProvider,
  makeQueryClient,
} from '../query/query-provider.js';
import { makeInMemoryPushChannel } from '../reactive/push-channel.js';
import {
  makePendingFlowStore,
  type PendingFlowStore,
} from './pending-flow-store.js';
import {
  PendingFlowStoreProvider,
  useOptimisticMutation,
  type UseOptimisticMutationOptions,
} from './use-optimistic-mutation.js';
import { usePendingFlowSettlement } from './use-pending-flow-settlement.js';

const links = [{ rel: 'status' as const, href: '/api/flow/f-1' }];

const wrapperWith =
  (store?: PendingFlowStore) =>
  ({ children }: { children: ReactNode }) => (
    <EntifixQueryProvider client={makeQueryClient()}>
      {store === undefined ? (
        children
      ) : (
        <PendingFlowStoreProvider store={store}>
          {children}
        </PendingFlowStoreProvider>
      )}
    </EntifixQueryProvider>
  );

/** A screen's view of one record, which the mutation edits optimistically. */
const makeScreen = () => {
  const screen = { name: 'before' };
  return {
    screen,
    apply: vi.fn((name: string) => {
      const previous = screen.name;
      screen.name = name;
      return previous;
    }),
    rollback: vi.fn((_name: string, previous: string) => {
      screen.name = previous;
    }),
    confirm: vi.fn(),
  };
};

const render = (
  options: UseOptimisticMutationOptions<string, string, string>,
  store?: PendingFlowStore,
) =>
  renderHook(() => useOptimisticMutation(options), {
    wrapper: wrapperWith(store),
  });

const answering =
  (result: WriteResult<string> | Declined) =>
  (): Effect.Effect<WriteResult<string>, Declined> =>
    result instanceof Declined ? Effect.fail(result) : Effect.succeed(result);

describe('useOptimisticMutation', () => {
  it('applies, then settles a write that happened, leaving no store entry', async () => {
    const store = makePendingFlowStore();
    const { screen, apply, rollback } = makeScreen();
    const { result } = render(
      { write: answering(settled('saved')), apply, rollback },
      store,
    );
    expect(result.current.status).toBe('idle');

    await act(() => result.current.mutate('after'));

    expect(screen.name).toBe('after');
    await waitFor(() => expect(result.current.status).toBe('settled'));
    expect(result.current.value).toBe('saved');
    expect(rollback).not.toHaveBeenCalled();
    expect(store.list()).toEqual([]);
  });

  it('rolls back a write that failed, rejects with its failure, and leaves no entry', async () => {
    const store = makePendingFlowStore();
    const { screen, apply, rollback } = makeScreen();
    const failure = new Declined({ reason: 'no' });
    const { result } = render(
      { write: answering(failure), apply, rollback },
      store,
    );

    await act(() =>
      expect(result.current.mutate('after')).rejects.toBe(failure),
    );

    expect(screen.name).toBe('before');
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.failure).toBe(failure);
    expect(store.list()).toEqual([]);
  });

  it('keeps a write handed to a flow pending, then confirms it when the flow completes', async () => {
    const store = makePendingFlowStore();
    const { screen, apply, rollback, confirm } = makeScreen();
    const { result } = render(
      {
        write: answering(pending('f-1', links)),
        apply,
        rollback,
        confirm,
        intent: name => ({ rename: name }),
      },
      store,
    );

    await act(() => result.current.mutate('after'));

    expect(result.current.status).toBe('pending');
    expect(result.current.flowId).toBe('f-1');
    expect(result.current.value).toBeUndefined();
    expect(store.list()).toMatchObject([
      { flowId: 'f-1', status: '/api/flow/f-1', intent: { rename: 'after' } },
    ]);

    act(() => {
      store.settle('f-1', { kind: 'confirmed' });
    });

    expect(result.current.status).toBe('confirmed');
    expect(confirm).toHaveBeenCalledWith('after', 'before');
    expect(screen.name).toBe('after');
  });

  it('rolls back a pending write whose flow failed', async () => {
    const store = makePendingFlowStore();
    const { screen, apply, rollback } = makeScreen();
    const failure = new Declined({ reason: 'card' });
    const { result } = render(
      { write: answering(pending('f-1')), apply, rollback },
      store,
    );

    await act(() => result.current.mutate('after'));
    act(() => {
      store.settle('f-1', { kind: 'failed', failure });
    });

    expect(result.current.status).toBe('failed');
    expect(result.current.failure).toBe(failure);
    expect(screen.name).toBe('before');
  });

  it('uses the store it is handed over the provided one, and needs no callbacks', async () => {
    const provided = makePendingFlowStore();
    const handed = makePendingFlowStore();
    const { result } = render(
      { write: answering(pending('f-1')), store: handed },
      provided,
    );

    await act(() => result.current.mutate('after'));
    act(() => {
      handed.settle('f-1', { kind: 'confirmed' });
    });

    expect(provided.list()).toEqual([]);
    expect(result.current.status).toBe('confirmed');

    const failing = render({ write: answering(pending('f-2')), store: handed });
    await act(() => failing.result.current.mutate('again'));
    act(() => {
      handed.settle('f-2', { kind: 'failed' });
    });
    expect(failing.result.current.status).toBe('failed');
    expect(failing.result.current.failure).toBeUndefined();
  });

  it('refuses, and rolls back, a pending write with no store to wait in', async () => {
    const { screen, apply, rollback } = makeScreen();
    const { result } = render({
      write: answering(pending('f-1')),
      apply,
      rollback,
    });

    await act(() =>
      expect(result.current.mutate('after')).rejects.toThrow(
        /no PendingFlowStore/,
      ),
    );
    expect(screen.name).toBe('before');
  });

  it('is running while the write is in flight', async () => {
    let answer = (_value: WriteResult<string>): void => undefined;
    const { result } = render({
      write: () =>
        Effect.promise(
          () =>
            new Promise<WriteResult<string>>(resolve => {
              answer = resolve;
            }),
        ),
    });

    let sent: Promise<WriteResult<string>> | undefined;
    act(() => {
      sent = result.current.mutate('after');
    });
    await waitFor(() => expect(result.current.status).toBe('running'));
    answer(settled('saved'));
    await act(() => sent);
    await waitFor(() => expect(result.current.status).toBe('settled'));
  });

  it('forgets a finished write on reset', async () => {
    const { result } = render({ write: answering(settled('saved')) });
    await act(() => result.current.mutate('after'));
    act(() => result.current.reset());
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.flowId).toBeUndefined();
  });
});

describe('a pending write, end to end', () => {
  const completed: DomainEvent = {
    name: 'flow.completed',
    id: 'f-1:done',
    source: 'checkout',
    at: '2026-11-02T10:00:01.000Z',
    data: { flowId: 'f-1', definition: 'checkout', slipVersion: 1 },
  };

  it('persists, survives a reload, and settles on push or on catch-up', async () => {
    const items = new Map<string, string>();
    const storage = {
      getItem: (name: string) => items.get(name) ?? null,
      setItem: (name: string, value: string) => {
        items.set(name, value);
      },
    };

    // The first tab writes, and is closed before the flow ends.
    const first = makePendingFlowStore({ storage });
    const tab = render({ write: answering(pending('f-1', links)) }, first);
    await act(() => tab.result.current.mutate('after'));
    tab.unmount();
    await new Promise(resolve => setTimeout(resolve, 0));

    // The reloaded tab finds it pending and hears the push.
    const channel = makeInMemoryPushChannel();
    const reloaded = makePendingFlowStore({ storage });
    await reloaded.ready;
    expect(reloaded.list().map(flow => flow.flowId)).toEqual(['f-1']);
    const onConfirmed = vi.fn();
    renderHook(() =>
      usePendingFlowSettlement({
        channel,
        store: reloaded,
        maxAgeMs: 60_000,
        onConfirmed,
      }),
    );
    await waitFor(() => expect(channel.topics()).toEqual(['flow:f-1']));
    act(() => channel.emit(['flow:f-1'], completed));
    expect(onConfirmed).toHaveBeenCalledTimes(1);

    // A tab that missed the push settles from the status read instead.
    items.set(
      'entifix.pending-flows',
      JSON.stringify({
        v: 1,
        flows: [
          {
            flowId: 'f-1',
            createdAt: new Date().toISOString(),
            status: '/api/flow/f-1',
          },
        ],
      }),
    );
    const late = makePendingFlowStore({ storage });
    await late.ready;
    const quiet = makeInMemoryPushChannel();
    renderHook(() =>
      usePendingFlowSettlement({
        channel: quiet,
        store: late,
        maxAgeMs: 60_000,
        readStatus: () => Effect.succeed({ flowId: 'f-1', state: 'completed' }),
      }),
    );
    act(() => quiet.connect());
    await waitFor(() => expect(late.list()).toEqual([]));
  });
});
