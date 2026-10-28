import { serializeEntity } from '@entifix/core';
import { runExit } from '@entifix/testing-unit';
import {
  ContractWidget,
  describeEntityFacetCounterContract,
} from '@entifix/testing-unit/contracts';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import { Cause, Effect, Exit } from 'effect';
import type { ClientSession, Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { makeMongoFacetCounter } from './make-mongo-facet-counter.js';

const COLLECTION = 'contract-widget';

/**
 * The counter runs against a fake mongodb driver rather than a fake port, so
 * the `$facet` pipeline it builds is the one executed.
 */
const withFakeDb = (seed: ContractWidget[] = []) => {
  const fake = makeFakeMongoDb({
    [COLLECTION]: seed.map(widget => serializeEntity(ContractWidget, widget)),
  });
  return {
    fake,
    counter: makeMongoFacetCounter(fake.db as Db, ContractWidget),
  };
};

describeEntityFacetCounterContract('mongo adapter over a fake driver', {
  makeCounter: seed => withFakeDb(seed).counter,
});

describe('makeMongoFacetCounter', () => {
  it('sends every facet in one aggregation', async () => {
    const { fake, counter } = withFakeDb();

    await Effect.runPromise(
      counter.count<ContractWidget>([{ member: 'name' }, { member: 'size' }]),
    );

    expect(fake.operations).toEqual([
      { collection: COLLECTION, op: 'aggregate' },
    ]);
  });

  it('asks the server nothing when nothing is asked', async () => {
    const { fake, counter } = withFakeDb();

    expect(await Effect.runPromise(counter.count([]))).toEqual({});
    expect(fake.operations).toEqual([]);
  });

  it('drops a value that is not a string, number or boolean', async () => {
    const fake = makeFakeMongoDb({
      [COLLECTION]: [{ id: 'w-1', name: { nested: true } }, { id: 'w-2' }],
    });
    const counter = makeMongoFacetCounter(fake.db as Db, ContractWidget);

    expect(
      await Effect.runPromise(
        counter.count<ContractWidget>([{ member: 'name' }]),
      ),
    ).toEqual({ name: [] });
  });

  it('answers a member the server left out with an empty list', async () => {
    const db = {
      collection: () => ({
        aggregate: () => ({ toArray: () => Promise.resolve([]) }),
      }),
    } as unknown as Db;

    expect(
      await Effect.runPromise(
        makeMongoFacetCounter(db, ContractWidget).count<ContractWidget>([
          { member: 'name' },
        ]),
      ),
    ).toEqual({ name: [] });
  });

  it('runs inside a session when given one', async () => {
    const options: unknown[] = [];
    const session = {} as ClientSession;
    const db = {
      collection: () => ({
        aggregate: (_: unknown, passed: unknown) => {
          options.push(passed);
          return { toArray: () => Promise.resolve([{ name: [] }]) };
        },
      }),
    } as unknown as Db;

    await Effect.runPromise(
      makeMongoFacetCounter(db, ContractWidget, {
        session,
      }).count<ContractWidget>([{ member: 'name' }]),
    );

    expect(options).toEqual([{ session }]);
  });

  it('maps a driver failure to Unavailable', async () => {
    const { fake, counter } = withFakeDb();
    fake.failOn('aggregate', new Error('down'));

    const exit = await runExit(
      counter.count<ContractWidget>([{ member: 'name' }]),
    );

    expect(
      Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined,
    ).toMatchObject({ _tag: 'Unavailable' });
  });
});
