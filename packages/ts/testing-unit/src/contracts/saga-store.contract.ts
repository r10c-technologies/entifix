import type {
  SagaInstance,
  SagaStepOutcome,
  SagaStore,
} from '@entifix/transactions';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

const run = <TValue, TError>(effect: Effect.Effect<TValue, TError>) =>
  Effect.runPromise(effect);

/** A threshold every instance is older than, so no spec waits on a clock. */
const ANY_AGE = -60_000;
/** A threshold no instance just written is older than. */
const AN_HOUR = 3_600_000;

const instance = (
  sagaId: string,
  over: Partial<Omit<SagaInstance, 'updatedAt'>> = {},
): Omit<SagaInstance, 'updatedAt'> => ({
  sagaId,
  definition: 'contract-flow',
  state: 'RUNNING',
  stepIndex: 0,
  outcomes: [],
  inputs: {},
  resumeAttempts: 0,
  createdAt: new Date().toISOString(),
  ...over,
});

const outcome = (stepId: string): SagaStepOutcome => ({ stepId, calls: [] });

/**
 * What every {@link SagaStore} must guarantee to the saga engine: an instance
 * that can be started twice without being overwritten, outcomes that append in
 * arrival order, a compensation flag that lands on one step, and a resume claim
 * that only ever takes an unfinished instance past its deadline.
 *
 * Deliberately not asserted: two concurrent claims producing one winner. That
 * is a property of the conditional write against a real server, and a contract
 * run in one process cannot interleave the two.
 */
export const describeSagaStoreContract = (
  name: string,
  makeStore: () => SagaStore | Promise<SagaStore>,
): void => {
  describe(`SagaStore contract: ${name}`, () => {
    it('starts an instance and reads it back, stamped', async () => {
      const store = await makeStore();

      await run(store.start(instance('s-1')));
      const read = await run(store.get('s-1'));

      expect(read).toMatchObject({ sagaId: 's-1', state: 'RUNNING' });
      expect(read?.updatedAt).toEqual(expect.any(String));
    });

    it('answers undefined for an instance it never started', async () => {
      const store = await makeStore();

      expect(await run(store.get('absent'))).toBeUndefined();
    });

    // A coordinator restarted mid-flight re-enters `start` with an id it
    // already wrote; what it had recorded must survive that.
    it('does not overwrite an instance started twice', async () => {
      const store = await makeStore();
      await run(store.start(instance('s-1')));
      await run(store.recordOutcome('s-1', outcome('reserve')));

      await run(store.start(instance('s-1', { stepIndex: 9 })));

      const read = await run(store.get('s-1'));
      expect(read?.stepIndex).toBe(0);
      expect(read?.outcomes.map(entry => entry.stepId)).toEqual(['reserve']);
    });

    it('moves the step index and appends outcomes in arrival order', async () => {
      const store = await makeStore();
      await run(store.start(instance('s-1')));

      await run(store.beginStep('s-1', 1));
      await run(store.recordOutcome('s-1', outcome('reserve')));
      await run(store.recordOutcome('s-1', outcome('charge')));

      const read = await run(store.get('s-1'));
      expect(read?.stepIndex).toBe(1);
      expect(read?.outcomes.map(entry => entry.stepId)).toEqual([
        'reserve',
        'charge',
      ]);
    });

    it('settles with a state and the error that caused it', async () => {
      const store = await makeStore();
      await run(store.start(instance('s-1')));

      await run(store.settle('s-1', 'COMPENSATED', 'charge refused'));

      expect(await run(store.get('s-1'))).toMatchObject({
        state: 'COMPENSATED',
        error: 'charge refused',
      });
    });

    it('flags only the named step compensated', async () => {
      const store = await makeStore();
      await run(store.start(instance('s-1')));
      await run(store.recordOutcome('s-1', outcome('reserve')));
      await run(store.recordOutcome('s-1', outcome('charge')));

      await run(store.markCompensated('s-1', 'reserve'));

      const read = await run(store.get('s-1'));
      expect(read?.outcomes).toEqual([
        expect.objectContaining({ stepId: 'reserve', compensated: true }),
        expect.not.objectContaining({ compensated: true }),
      ]);
    });

    // `COMPENSATING` is stuck too: a coordinator that died while unwinding is
    // the state that leaves holds in place.
    it('finds unfinished instances past the deadline, and nothing else', async () => {
      const store = await makeStore();
      await run(store.start(instance('running')));
      await run(store.start(instance('unwinding', { state: 'COMPENSATING' })));
      await run(store.start(instance('done', { state: 'COMPLETED' })));

      const stale = await run(store.findStale(ANY_AGE));
      expect(stale.map(entry => entry.sagaId).sort()).toEqual([
        'running',
        'unwinding',
      ]);
      expect(await run(store.findStale(AN_HOUR))).toEqual([]);
    });

    it('claims a stale instance by counting the attempt', async () => {
      const store = await makeStore();
      await run(store.start(instance('s-1')));

      const claimed = await run(store.claimForResume('s-1', ANY_AGE));

      expect(claimed).toMatchObject({ sagaId: 's-1', resumeAttempts: 1 });
      expect((await run(store.get('s-1')))?.resumeAttempts).toBe(1);
    });

    it('refuses to claim a settled or a fresh instance', async () => {
      const store = await makeStore();
      await run(store.start(instance('done', { state: 'COMPLETED' })));
      await run(store.start(instance('fresh')));

      expect(await run(store.claimForResume('done', ANY_AGE))).toBeUndefined();
      expect(await run(store.claimForResume('fresh', AN_HOUR))).toBeUndefined();
      expect(
        await run(store.claimForResume('absent', ANY_AGE)),
      ).toBeUndefined();
    });
  });
};
