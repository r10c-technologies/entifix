import { defineServiceE2e } from '@entifix/testing-e2e/service';
import { describe, expect, it } from 'vitest';

import { mongo, startMockService } from './support/mock-service.ts';

/**
 * The backend tier end to end, under either profile.
 *
 * Every journey mints its own SKU, so a live run against a database that has
 * seen earlier runs asserts on nothing it did not create.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'EXAMPLE_SERVICE_URL',
  startMock: startMockService,
  // `@entifix/testing-auth` trusts any token, but one must be present.
  authorization: () => Promise.resolve('Bearer example'),
});

const sku = () => `sku-${globalThis.crypto.randomUUID().slice(0, 8)}`;

const stock = async (code: string, available: number) => {
  const response = await service.client.put(`/api/stock-item/${code}`, {
    meta: { type: 'entity', entity: 'stock-item' },
    data: { sku: code, name: `Item ${code}`, available },
  });
  expect(response.status).toBe(200);
};

const availableOf = async (code: string) =>
  (await service.client.get(`/api/stock-item/${code}`)).data.data.available;

const order = (body: object, idempotencyKey?: string) =>
  service.client.post('/api/order', body, {
    headers:
      idempotencyKey === undefined ? {} : { 'Idempotency-Key': idempotencyKey },
  });

const eventually = async <T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const value = await read();
    if (done(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return read();
};

describe('the generated CRUD surface', () => {
  it('stores, reads and lists a record, and serves its metadata', async () => {
    const code = sku();
    await stock(code, 5);

    expect(await availableOf(code)).toBe(5);
    const list = await service.client.get(`/api/stock-item?sku=${code}`);
    expect(list.status).toBe(200);
    expect(list.data.data.items ?? list.data.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ sku: code })]),
    );

    const metadata = await service.client.get('/api/stock-item/$metadata');
    expect(metadata.status).toBe(200);
    expect(metadata.data.data.actions).toEqual(
      expect.arrayContaining(['read', 'write']),
    );
  });

  it('refuses a request with no token', async () => {
    const response = await service.client.get('/api/stock-item', {
      headers: { Authorization: '' },
    });
    expect(response.status).toBe(401);
  });
});

describe('placing an order', () => {
  it('runs the saga to completion: stock held, order written, event announced', async () => {
    const code = sku();
    await stock(code, 5);

    const placed = await order({ sku: code, quantity: 2, amount: 40 });

    expect(placed.status).toBe(201);
    expect(placed.data.state).toBe('COMPLETED');
    expect(await availableOf(code)).toBe(3);

    const saga = await service.client.get(`/api/saga/${placed.data.sagaId}`);
    expect(saga.data.state).toBe('COMPLETED');
    expect(saga.data.outcomes.map((o: { stepId: string }) => o.stepId)).toEqual(
      ['reserve', 'charge', 'confirm'],
    );

    if (service.profile === 'mock') {
      // The fake bus delivers nothing, so what is proven here is the half that
      // matters most: the event was written in the order's own transaction.
      expect(
        mongo
          ?.read('transaction_outbox')
          .map(entry => (entry['event'] as { name: string }).name),
      ).toContain('order.placed');
    } else {
      // Live: relayed to RabbitMQ and consumed back into the projection.
      const stats = await eventually(
        async () => (await service.client.get('/api/order-stats')).data,
        value => value.units >= 2,
      );
      expect(stats.units).toBeGreaterThanOrEqual(2);
    }
  });

  it('compensates when the pivot refuses: the hold is given back', async () => {
    const code = sku();
    await stock(code, 5);

    const refused = await order({ sku: code, quantity: 2, amount: 5000 });

    expect(refused.status).toBe(409);
    expect(refused.data.state).toBe('COMPENSATED');
    expect(await availableOf(code)).toBe(5);
  });

  it('refuses before anything is held when the stock is not there', async () => {
    const code = sku();
    await stock(code, 1);

    const refused = await order({ sku: code, quantity: 2, amount: 40 });

    expect(refused.data.state).toBe('COMPENSATED');
    expect(await availableOf(code)).toBe(1);
  });

  it('does nothing twice when a request is retried with the same key', async () => {
    const code = sku();
    await stock(code, 5);
    const key = globalThis.crypto.randomUUID();

    const first = await order({ sku: code, quantity: 2, amount: 40 }, key);
    const retried = await order({ sku: code, quantity: 2, amount: 40 }, key);

    expect(first.data.state).toBe('COMPLETED');
    expect(retried.data).toMatchObject({ sagaId: key, state: 'COMPLETED' });
    expect(await availableOf(code)).toBe(3);
  });
});

describe('readiness', () => {
  it('answers ready', async () => {
    const response = await service.client.get('/api/health/ready');
    expect(response.status).toBe(200);
  });
});
