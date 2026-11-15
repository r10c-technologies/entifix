import { EntityRepositoryTag } from '@entifix/business';
import {
  accessor,
  type DomainEvent,
  type Entity,
  entity,
  type EntityChangeEvent,
  type EntityId,
  type EntityLoadRequest,
  Unavailable,
} from '@entifix/core';
import {
  EntifixQueryProvider,
  makeInMemoryReactiveChannel,
  makeQueryClient,
  useReactiveInvalidation,
} from '@entifix/react-integration';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Context, Effect } from 'effect';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useEntityTotal } from './use-entity-total.js';

@entity({ domain: 'shipping', key: 'shipment' })
class Shipment implements Entity {
  #id?: EntityId;
  #status = 'awaiting';

  constructor(id?: string, status = 'awaiting') {
    this.#id = id;
    this.#status = status;
  }

  @accessor({ type: 'id', filterable: true })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'enum', enumValues: ['awaiting', 'dispatched'] })
  get status(): string {
    return this.#status;
  }
  set status(value: string) {
    this.#status = value;
  }
}

/** A repository whose loads are recorded. */
function counted(items: Entity[]) {
  const repository = makeInMemoryEntityRepository(items);
  const loads: EntityLoadRequest<Entity>[] = [];
  return {
    repository,
    loads,
    context: Context.make(EntityRepositoryTag, {
      ...repository,
      load: (request: EntityLoadRequest<Entity>) => {
        loads.push(request);
        return repository.load(request);
      },
    } as never),
  };
}

const awaiting = {
  operator: 'and' as const,
  values: [
    { property: 'status' as const, operator: 'eq' as const, value: 'awaiting' },
  ],
};

const change = (name: string): DomainEvent<EntityChangeEvent> => ({
  name: 'shipment.changed',
  id: 'e-1',
  source: 'spec',
  at: '2026-11-15T00:00:00.000Z',
  correlationId: 'e-1',
  data: { entity: name, change: 'updated', id: 's-9' },
});

function setup(items: Entity[]) {
  const store = counted(items);
  const channel = makeInMemoryReactiveChannel();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <EntifixQueryProvider client={makeQueryClient()}>
      {children}
    </EntifixQueryProvider>
  );
  const hook = renderHook(
    () => {
      useReactiveInvalidation(channel);
      return useEntityTotal({
        entity: Shipment,
        ctx: store.context,
        filtering: awaiting,
      });
    },
    { wrapper },
  );
  return { store, channel, hook };
}

describe('useEntityTotal', () => {
  it('counts with one read of a one-record page', async () => {
    const { store, hook } = setup([
      new Shipment('s-1'),
      new Shipment('s-2'),
      new Shipment('s-3', 'dispatched'),
    ]);

    expect(hook.result.current.state).toBe('loading');
    await waitFor(() => expect(hook.result.current.state).toBe('ready'));
    expect(hook.result.current.total).toBe(2);
    expect(store.loads).toHaveLength(1);
    expect(store.loads[0]).toMatchObject({ page: 1, pageSize: 1 });
    expect(store.loads[0]?.filtering).toEqual([awaiting]);
  });

  it('reads the count again when a change to the entity is pushed', async () => {
    const { store, channel, hook } = setup([new Shipment('s-1')]);
    await waitFor(() => expect(hook.result.current.total).toBe(1));

    await act(async () => {
      await Effect.runPromise(store.repository.save(new Shipment('s-9')));
    });
    act(() => channel.emit(change('shipment')));

    await waitFor(() => expect(hook.result.current.total).toBe(2));
    expect(store.loads).toHaveLength(2);
  });

  it('fails on its own, and retries', async () => {
    const store = counted([new Shipment('s-1')]);
    store.repository.failNext(new Unavailable());
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EntifixQueryProvider client={makeQueryClient()}>
        {children}
      </EntifixQueryProvider>
    );
    const { result } = renderHook(
      () => useEntityTotal({ entity: Shipment, ctx: store.context }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.state).toBe('failed'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.total).toBe(1);
  });

  it('stays loading without a repository', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EntifixQueryProvider client={makeQueryClient()}>
        {children}
      </EntifixQueryProvider>
    );
    const { result } = renderHook(
      () => useEntityTotal({ entity: Shipment, ctx: undefined }),
      { wrapper },
    );

    expect(result.current).toMatchObject({
      state: 'loading',
      total: undefined,
    });
  });
});
