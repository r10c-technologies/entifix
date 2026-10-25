import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { describeUnitOfWorkContract } from '../contracts/unit-of-work.contract.js';
import { makeInMemoryUnitOfWork } from './unit-of-work.js';

describeUnitOfWorkContract('in-memory', () => {
  const unitOfWork = makeInMemoryUnitOfWork();
  return {
    unitOfWork,
    write: (handle, id) =>
      Effect.sync(() => {
        handle.records.set(id, true);
      }),
    readIn: (handle, id) => Effect.sync(() => handle.records.has(id)),
    stored: id => Promise.resolve(unitOfWork.records.has(id)),
    recorded: () => Promise.resolve(unitOfWork.outbox.map(event => event.id)),
  };
});

describe('makeInMemoryUnitOfWork', () => {
  it('starts from its seed', () => {
    const unitOfWork = makeInMemoryUnitOfWork([['seeded', 1]]);

    expect(unitOfWork.records.get('seeded')).toBe(1);
  });

  it('remembers nothing for a command claim run without a replay', async () => {
    const unitOfWork = makeInMemoryUnitOfWork();
    const claim = { kind: 'command', commandId: 'c-plain' } as const;

    await Effect.runPromise(unitOfWork.run(() => Effect.succeed(1), { claim }));
    const again = await Effect.runPromise(
      unitOfWork.run(() => Effect.succeed(2), { claim }),
    );

    expect(again._tag).toBe('duplicate');
    expect(await Effect.runPromise(unitOfWork.replay('c-plain'))).toMatchObject(
      { _tag: 'None' },
    );
  });
});
