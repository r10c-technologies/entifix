import { EntifixConnError } from '@entifix/core';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  type ContractWidget,
  describeEntityFacetCounterContract,
  makeContractWidget,
} from '../contracts/index.js';
import { run, runExit } from '../effect/run.js';
import { makeInMemoryFacetCounter } from './entity-facet-counter.js';
import { makeInMemoryEntityRepository } from './entity-repository.js';

describeEntityFacetCounterContract('in-memory fake', {
  makeCounter: seed => makeInMemoryFacetCounter(seed),
});

describe('makeInMemoryFacetCounter', () => {
  it('reads a repository on every count, so a save moves the counts', async () => {
    const repository = makeInMemoryEntityRepository([
      makeContractWidget('w-1', 'Alpha', 1),
    ]);
    const counter = makeInMemoryFacetCounter(repository);

    await run(repository.save(makeContractWidget('w-2', 'Alpha', 2)));

    expect(
      await run(counter.count<ContractWidget>([{ member: 'name' }])),
    ).toEqual({ name: [{ value: 'Alpha', count: 2 }] });
  });

  it('fails the next count only, when told to', async () => {
    const counter = makeInMemoryFacetCounter([]);
    counter.failNext(new EntifixConnError('down'));

    const failed = await runExit(
      counter.count<ContractWidget>([{ member: 'name' }]),
    );
    const next = await run(counter.count<ContractWidget>([{ member: 'name' }]));

    expect(Exit.isFailure(failed)).toBe(true);
    expect(next).toEqual({ name: [] });
  });
});
