import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  InvalidRecords,
} from '@entifix/core';
import { run, runExit } from '@entifix/testing-unit';
import {
  ContractWidget,
  describeEntityFacetCounterContract,
  describeEntityRepositoryReadContract,
  makeContractWidget,
} from '@entifix/testing-unit/contracts';
import { Cause, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { staticRepositoryFromRecords } from './from-records.js';
import {
  makeStaticFacetCounter,
  makeStaticRepository,
} from './static-repository.js';

// The read half only: a static source refuses writes by design.
describeEntityRepositoryReadContract('static repository', {
  makeRepository: seed => makeStaticRepository(ContractWidget, seed),
});

describeEntityFacetCounterContract('static facet counter', {
  makeCounter: seed => makeStaticFacetCounter(seed),
});

const failureOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

describe('makeStaticRepository', () => {
  const repository = makeStaticRepository(ContractWidget, [
    makeContractWidget('w-1', 'Alpha', 10),
  ]);

  it('refuses to save or delete, naming the entity and the verb', async () => {
    const saved = failureOf(
      await runExit(repository.save(makeContractWidget('w-2', 'Beta', 20))),
    );
    const deleted = failureOf(
      await runExit(repository.delete<ContractWidget>('w-1')),
    );

    expect(saved).toMatchObject({ _tag: 'Declined', category: 'declined' });
    expect((saved as Error).message).toBe(
      'Cannot save a ContractWidget: it is served from static content, which is read-only',
    );
    expect((deleted as Error).message).toMatch(
      /^Cannot delete a ContractWidget/,
    );
  });

  it('fails an unknown id with the label it was given', async () => {
    const labelled = makeStaticRepository(ContractWidget, [], {
      label: 'widgets.json',
    });
    const failure = failureOf(
      await runExit(labelled.get<ContractWidget>('nope')),
    );

    expect(failure).toMatchObject({ _tag: 'NotFound', entity: 'widgets.json' });
  });

  it('copies a record whose class declares no accessors member by member', async () => {
    class Bare implements Entity {
      constructor(
        public id: EntityId,
        public name: string,
      ) {}
    }
    const original = new Bare('b-1', 'Plain');
    const bare = makeStaticRepository(Bare, [original]);

    const found = await run(bare.get<Bare>('b-1'));

    expect(found).toBeInstanceOf(Bare);
    expect(found).toEqual(original);
    expect(found).not.toBe(original);
  });
});

@entity({ key: 'event' })
class Event implements Entity {
  #id?: EntityId;
  #name?: string;
  #at?: Date;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', required: true })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }

  @accessor({ type: 'date' })
  get at(): Date | undefined {
    return this.#at;
  }
  set at(value: Date | undefined) {
    this.#at = value;
  }
}

describe('staticRepositoryFromRecords', () => {
  it('validates the records, parses their dates, and serves them', async () => {
    const repository = staticRepositoryFromRecords(Event, [
      { id: 'e-1', name: 'Launch', at: '2026-01-01' },
      { id: 'e-2', name: 'Retro', at: '2026-02-01' },
    ]);

    const page = await run(
      repository.load<Event>({
        filtering: [
          { property: 'at', operator: 'gt', value: new Date('2026-01-15') },
        ],
      }),
    );

    expect(page.items.map(item => item.id)).toEqual(['e-2']);
    expect(page.items[0]?.at).toEqual(new Date('2026-02-01'));
  });

  it('throws every problem before serving anything', () => {
    expect(() =>
      staticRepositoryFromRecords(Event, [{ id: 'e-1', at: 'soon' }], {
        source: 'events.json',
      }),
    ).toThrow(InvalidRecords);
    expect(() =>
      staticRepositoryFromRecords(Event, [{ id: 'e-1', at: 'soon' }], {
        source: 'events.json',
      }),
    ).toThrow(
      'Records are invalid:\n' +
        '  events.json › e-1 › name is required, and is missing\n' +
        '  events.json › e-1 › at is not a date: "soon"',
    );
  });
});
