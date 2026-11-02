import { describe, expect, it, vi } from 'vitest';

import {
  makePendingFlowStore,
  PENDING_FLOW_STORE_VERSION,
  type PendingFlowStorage,
} from './pending-flow-store.js';

const AT = new Date('2026-11-02T10:00:00.000Z');
const now = () => AT;

/** A storage that survives the store, the way a reload keeps IndexedDB. */
const memoryStorage = (initial?: string) => {
  const items = new Map<string, string>();
  if (initial !== undefined) items.set('entifix.pending-flows', initial);
  const storage: PendingFlowStorage = {
    getItem: name => Promise.resolve(items.get(name) ?? null),
    setItem: (name, value) => {
      items.set(name, value);
      return Promise.resolve();
    },
  };
  return { storage, items };
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('makePendingFlowStore', () => {
  it('records a pending flow under its topic, and replaces one added twice', () => {
    const store = makePendingFlowStore({ now });
    store.add({ flowId: 'f-1', intent: { save: 'widget' } });
    const flow = store.add({
      flowId: 'f-1',
      status: '/api/flow/f-1',
      intent: { save: 'widget', n: [1, null, true] },
    });

    expect(flow).toEqual({
      flowId: 'f-1',
      topic: 'flow:f-1',
      createdAt: AT.toISOString(),
      status: '/api/flow/f-1',
      intent: { save: 'widget', n: [1, null, true] },
    });
    expect(store.list()).toEqual([flow]);
  });

  it('settles a flow once, telling its listeners and nobody after', () => {
    const store = makePendingFlowStore({ now });
    const changed = vi.fn();
    const settled = vi.fn();
    const gone = vi.fn();
    store.subscribe(changed);
    store.add({ flowId: 'f-1' });
    store.onSettled('f-1', settled);
    store.onSettled('f-1', gone)();

    expect(store.settle('f-1', { kind: 'confirmed' })).toBe(true);
    expect(store.settle('f-1', { kind: 'confirmed' })).toBe(false);
    expect(store.settle('never', { kind: 'confirmed' })).toBe(false);

    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith({ kind: 'confirmed' });
    expect(gone).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(store.list()).toEqual([]);
  });

  it('stops telling a list listener that unsubscribed', () => {
    const store = makePendingFlowStore();
    const changed = vi.fn();
    store.subscribe(changed)();
    store.add({ flowId: 'f-1' });
    expect(changed).not.toHaveBeenCalled();
  });

  it.each([
    ['a function', () => 1],
    ['a date', new Date()],
    ['a map', new Map()],
    ['a non-finite number', Number.NaN],
    ['a nested undefined', { a: undefined }],
    ['a class instance in an array', [new (class Thing {})()]],
    ['a symbol', Symbol('s')],
  ])(
    'rejects %s as an intent at write, and stores nothing',
    (_label, intent) => {
      const store = makePendingFlowStore();
      expect(() => store.add({ flowId: 'f-1', intent })).toThrow(TypeError);
      expect(store.list()).toEqual([]);
    },
  );

  it('accepts a prototype-free record as an intent', () => {
    const store = makePendingFlowStore();
    const intent = Object.assign(Object.create(null) as object, { a: 'b' });
    expect(() => store.add({ flowId: 'f-1', intent })).not.toThrow();
  });

  it('keeps only ids and age in an anonymous scope', () => {
    const store = makePendingFlowStore({ anonymous: true, now });
    expect(
      store.add({ flowId: 'f-1', status: '/s', intent: () => 'personal' }),
    ).toEqual({
      flowId: 'f-1',
      topic: 'flow:f-1',
      createdAt: AT.toISOString(),
    });
  });

  it('survives a reload through its storage, as { v, flows }', async () => {
    const { storage, items } = memoryStorage();
    const first = makePendingFlowStore({ storage, now });
    await first.ready;
    first.add({ flowId: 'f-1', status: '/api/flow/f-1', intent: { a: 1 } });
    first.add({ flowId: 'f-2' });
    first.settle('f-2', { kind: 'confirmed' });
    await flush();

    expect(JSON.parse(items.get('entifix.pending-flows') ?? '')).toEqual({
      v: PENDING_FLOW_STORE_VERSION,
      flows: [
        {
          flowId: 'f-1',
          topic: 'flow:f-1',
          createdAt: AT.toISOString(),
          status: '/api/flow/f-1',
          intent: { a: 1 },
        },
      ],
    });

    const reloaded = makePendingFlowStore({ storage });
    await reloaded.ready;
    expect(reloaded.list()).toEqual(first.list());
  });

  it('keeps what was added before the stored flows were read back', async () => {
    const stored = JSON.stringify({
      v: PENDING_FLOW_STORE_VERSION,
      flows: [
        { flowId: 'old', createdAt: AT.toISOString() },
        { flowId: 'f-1', createdAt: '2000-01-01T00:00:00.000Z' },
      ],
    });
    const { storage } = memoryStorage(stored);
    const store = makePendingFlowStore({ storage, now });
    store.add({ flowId: 'f-1' });
    await store.ready;

    expect(store.list().map(flow => [flow.flowId, flow.createdAt])).toEqual([
      ['old', AT.toISOString()],
      ['f-1', AT.toISOString()],
    ]);
  });

  it.each([
    ['an older version', JSON.stringify({ v: 0, flows: [{ flowId: 'f' }] })],
    ['a value that is not JSON', '{not json'],
    ['a value of another shape', JSON.stringify({ v: 1, flows: 'f' })],
  ])('discards %s', async (_label, stored) => {
    const store = makePendingFlowStore({
      storage: memoryStorage(stored).storage,
    });
    await store.ready;
    expect(store.list()).toEqual([]);
  });

  it('starts empty when storage cannot be read, and keeps working when it cannot be written', async () => {
    const changed = vi.fn();
    const store = makePendingFlowStore({
      storage: {
        getItem: () => Promise.reject(new Error('blocked')),
        setItem: () => Promise.reject(new Error('quota')),
      },
    });
    store.subscribe(changed);
    await store.ready;
    expect(changed).not.toHaveBeenCalled();
    store.add({ flowId: 'f-1' });
    await flush();
    expect(store.list()).toHaveLength(1);
  });

  it('reads a storage that answers synchronously, under the host key', async () => {
    const getItem = vi.fn(() => null);
    const store = makePendingFlowStore({
      storage: { getItem, setItem: () => undefined },
      key: 'scope:alan',
    });
    await store.ready;
    expect(getItem).toHaveBeenCalledWith('scope:alan');
    expect(store.add({ flowId: 'f-1' }).createdAt).toMatch(/^\d{4}-/);
  });
});
