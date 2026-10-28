import { type DomainEvent, type StoreFault, Unavailable } from '@entifix/core';
import type { UnitOfWork } from '@entifix/transactions';
import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

/** What {@link describeUnitOfWorkContract} needs to observe a store. */
export interface UnitOfWorkContractHarness<H> {
  readonly unitOfWork: UnitOfWork<H>;
  /** Writes one record through the unit's handle. */
  write(handle: H, id: string): Effect.Effect<void, StoreFault>;
  /** Whether a record exists, read through the unit's handle. */
  readIn(handle: H, id: string): Effect.Effect<boolean, StoreFault>;
  /** Whether a record is durable, read outside any unit. */
  stored(id: string): Promise<boolean>;
  /** The ids of every event the outbox holds. */
  recorded(): Promise<readonly string[]>;
}

const anEvent = (id: string): DomainEvent => ({
  name: 'contract.widget.changed',
  id,
  source: 'contract-slice',
  at: '2026-01-01T00:00:00.000Z',
  correlationId: id,
  data: {},
});

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

/**
 * What every {@link UnitOfWork} must guarantee: the writes, the events and the
 * claim of one unit commit or vanish together; a taken claim turns the next
 * unit into a `duplicate` without running it; a business failure is an
 * `aborted` value and a store failure is an error; and what a unit wrote is
 * visible to itself before it commits.
 */
export const describeUnitOfWorkContract = <H>(
  name: string,
  makeHarness: () =>
    UnitOfWorkContractHarness<H> | Promise<UnitOfWorkContractHarness<H>>,
): void => {
  describe(`UnitOfWork contract: ${name}`, () => {
    it('commits the writes and the events together', async () => {
      const harness = await makeHarness();

      const outcome = await run(
        harness.unitOfWork.run(unit =>
          harness.write(unit.handle, 'w-1').pipe(
            Effect.tap(() => Effect.sync(() => unit.emit(anEvent('e-1')))),
            Effect.as('done'),
          ),
        ),
      );

      expect(outcome).toEqual({ _tag: 'committed', value: 'done' });
      expect(await harness.stored('w-1')).toBe(true);
      expect(await harness.recorded()).toContain('e-1');
    });

    it('answers a business failure as aborted, and writes nothing', async () => {
      const harness = await makeHarness();

      const outcome = await run(
        harness.unitOfWork.run(unit =>
          harness.write(unit.handle, 'w-2').pipe(
            Effect.tap(() => Effect.sync(() => unit.emit(anEvent('e-2')))),
            Effect.andThen(Effect.fail('outOfStock' as const)),
          ),
        ),
      );

      expect(outcome).toEqual({ _tag: 'aborted', reason: 'outOfStock' });
      expect(await harness.stored('w-2')).toBe(false);
      expect(await harness.recorded()).not.toContain('e-2');
    });

    it('surfaces a store failure as an error, and writes nothing', async () => {
      const harness = await makeHarness();

      const error = await run(
        harness.unitOfWork
          .run(unit =>
            harness
              .write(unit.handle, 'w-3')
              .pipe(
                Effect.andThen(
                  Effect.fail(new Unavailable({ dependency: 'store' })),
                ),
              ),
          )
          .pipe(Effect.flip),
      );

      expect(error).toMatchObject({ _tag: 'Unavailable' });
      expect(await harness.stored('w-3')).toBe(false);
    });

    it('lets a unit read its own uncommitted writes', async () => {
      const harness = await makeHarness();

      const outcome = await run(
        harness.unitOfWork.run(unit =>
          harness
            .write(unit.handle, 'w-4')
            .pipe(Effect.andThen(harness.readIn(unit.handle, 'w-4'))),
        ),
      );

      expect(outcome).toEqual({ _tag: 'committed', value: true });
    });

    it('turns a second unit on a taken event claim into a duplicate that does not run', async () => {
      const harness = await makeHarness();
      const claim = {
        kind: 'event',
        consumer: 'contract.fold',
        eventId: 'm-1',
      } as const;
      let runs = 0;
      const body = (unit: { handle: H }) =>
        Effect.suspend(() => {
          runs += 1;
          return harness.write(unit.handle, `fold-${runs}`);
        });

      const first = await run(harness.unitOfWork.run(body, { claim }));
      const second = await run(harness.unitOfWork.run(body, { claim }));

      expect(first._tag).toBe('committed');
      expect(second).toEqual({ _tag: 'duplicate', replay: Option.none() });
      expect(await harness.stored('fold-2')).toBe(false);
    });

    it('keys an event claim on the consumer as well as the event', async () => {
      const harness = await makeHarness();
      const noop = () => Effect.void;

      const one = await run(
        harness.unitOfWork.run(noop, {
          claim: { kind: 'event', consumer: 'contract.a', eventId: 'm-2' },
        }),
      );
      const other = await run(
        harness.unitOfWork.run(noop, {
          claim: { kind: 'event', consumer: 'contract.b', eventId: 'm-2' },
        }),
      );

      expect(one._tag).toBe('committed');
      expect(other._tag).toBe('committed');
    });

    it('answers a duplicate command with what the first run remembered', async () => {
      const harness = await makeHarness();
      const claim = { kind: 'command', commandId: 'c-1' } as const;
      const options = {
        claim,
        replay: (value: { paymentId: string }) => value,
      };

      let runs = 0;
      const capture = (unit: { handle: H }) =>
        Effect.suspend(() => {
          runs += 1;
          const paymentId = `pay-${runs}`;
          return harness
            .write(unit.handle, paymentId)
            .pipe(Effect.as({ paymentId }));
        });

      await run(harness.unitOfWork.run(capture, options));
      const again = await run(harness.unitOfWork.run(capture, options));

      expect(again).toEqual({
        _tag: 'duplicate',
        replay: Option.some({ paymentId: 'pay-1' }),
      });
      // A redelivered capture must not charge again, so the body never reruns.
      expect(runs).toBe(1);
      expect(await run(harness.unitOfWork.replay('c-1'))).toEqual(
        Option.some({ paymentId: 'pay-1' }),
      );
      expect(await run(harness.unitOfWork.replay('c-unknown'))).toEqual(
        Option.none(),
      );
    });

    it('leaves a claim untaken when its unit aborts', async () => {
      const harness = await makeHarness();
      const claim = { kind: 'command', commandId: 'c-2' } as const;

      const refused = await run(
        harness.unitOfWork.run(() => Effect.fail('declined' as const), {
          claim,
        }),
      );
      const retried = await run(
        harness.unitOfWork.run(() => Effect.succeed('ok'), { claim }),
      );

      expect(refused._tag).toBe('aborted');
      expect(retried).toEqual({ _tag: 'committed', value: 'ok' });
    });

    it('treats an event id already in the outbox as a duplicate', async () => {
      const harness = await makeHarness();
      const announce = (id: string) =>
        harness.unitOfWork.run(unit =>
          harness
            .write(unit.handle, id)
            .pipe(
              Effect.tap(() => Effect.sync(() => unit.emit(anEvent('e-same')))),
            ),
        );

      await run(announce('w-5'));
      const again = await run(announce('w-6'));

      expect(again._tag).toBe('duplicate');
      expect(await harness.stored('w-6')).toBe(false);
    });

    it('runs afterCommit only on commit, and never lets it change the outcome', async () => {
      const harness = await makeHarness();
      const ran: string[] = [];
      const after = (label: string) => ({
        afterCommit: Effect.sync(() => ran.push(label)).pipe(
          Effect.andThen(Effect.fail('drain failed')),
        ),
      });

      const committed = await run(
        harness.unitOfWork.run(() => Effect.succeed(1), after('commit')),
      );
      await run(
        harness.unitOfWork.run(
          () => Effect.fail('no' as const),
          after('abort'),
        ),
      );

      expect(committed).toEqual({ _tag: 'committed', value: 1 });
      expect(ran).toEqual(['commit']);
    });
  });
};
