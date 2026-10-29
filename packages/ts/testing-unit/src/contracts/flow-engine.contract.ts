import {
  defineCatalog,
  defineFragment,
  type FragmentCatalog,
  type FragmentDescriptor,
  fragmentRef,
  type Slip,
  type SlipStep,
} from '@entifix/business/flow';
import { Declined } from '@entifix/core';
import type { FlowEngine } from '@entifix/transactions';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { FakeParticipant } from '../doubles/flow-engine.js';

const contract = {
  input: Schema.Unknown,
  output: Schema.Unknown,
  failure: Schema.Unknown,
};

const fragment = (
  id: string,
  kind: FragmentDescriptor['kind'],
): FragmentDescriptor =>
  defineFragment({
    id: `contract.${id}`,
    version: 1,
    module: 'contract',
    kind,
    participant: 'contract',
    call: { method: 'POST', path: `/api/${id}` },
    ...(kind === 'compensatable'
      ? { compensation: { method: 'DELETE', path: `/api/${id}/:id` } as const }
      : {}),
    cardinality: 'one',
    contract,
  });

const hold = fragment('hold', 'compensatable');
const take = fragment('take', 'pivot');
const settle = fragment('settle', 'retriable');
const wait = fragment('await', 'wait');

/** The catalog every case composes its slips from. */
export const flowEngineContractCatalog: FragmentCatalog = defineCatalog([
  hold,
  take,
  settle,
  wait,
]);

const stepOf = (descriptor: FragmentDescriptor): SlipStep => ({
  ref: fragmentRef(descriptor),
  step: descriptor.id.replace('contract.', ''),
  cardinality: 'one',
});

const slipOf = (
  flowId: string,
  steps: readonly FragmentDescriptor[],
): Slip => ({
  slipVersion: 1,
  flowId,
  recipe: 'contract',
  stages: [{ name: 'main', steps: steps.map(stepOf) }],
  resolution: [],
  composedAt: '2026-01-01T00:00:00.000Z',
});

const failing =
  (failAt: string): FakeParticipant =>
  step =>
    step.step === failAt
      ? Effect.fail(new Declined({ reason: 'refused' }))
      : Effect.succeed({ ok: true });

const succeeding: FakeParticipant = () => Effect.succeed({ ok: true });

/**
 * What every {@link FlowEngine} must guarantee, whatever runs it: a start is
 * idempotent on its key, a failure before the commit point compensates and one
 * after it suspends, a wait takes the signal it waits for and no other, and an
 * unknown flow is a typed `FlowNotFound`.
 *
 * `make` builds a fresh engine over the contract's catalog and the participant
 * a case supplies.
 */
export const describeFlowEngineContract = (
  name: string,
  make: (catalog: FragmentCatalog, participant: FakeParticipant) => FlowEngine,
): void => {
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
  const state = async (engine: FlowEngine, flowId: string) =>
    (await run(engine.status(flowId))).state;

  describe(`FlowEngine contract: ${name}`, () => {
    it('answers the slip’s flow id, and the same one for a repeated key', async () => {
      const engine = make(flowEngineContractCatalog, succeeding);
      const slip = slipOf('flow-1', [hold, take, settle]);

      const first = await run(engine.start(slip, 'key-1'));
      const again = await run(engine.start(slipOf('flow-2', [hold]), 'key-1'));

      expect(first).toEqual({ flowId: 'flow-1' });
      expect(again).toEqual({ flowId: 'flow-1' });
    });

    it('completes a flow whose every step succeeds', async () => {
      const engine = make(flowEngineContractCatalog, succeeding);
      await run(engine.start(slipOf('flow-1', [hold, take, settle]), 'k'));

      expect(await state(engine, 'flow-1')).toBe('completed');
    });

    it('compensates a failure before the commit point', async () => {
      const engine = make(flowEngineContractCatalog, failing('take'));
      await run(engine.start(slipOf('flow-1', [hold, take, settle]), 'k'));

      expect(await state(engine, 'flow-1')).toBe('compensated');
    });

    it('suspends a failure after the commit point, at that step', async () => {
      const engine = make(flowEngineContractCatalog, failing('settle'));
      await run(engine.start(slipOf('flow-1', [hold, take, settle]), 'k'));

      expect(await run(engine.status('flow-1'))).toMatchObject({
        state: 'suspended',
        step: 'settle',
      });
    });

    it('waits for the signal it waits for, and refuses any other', async () => {
      const engine = make(flowEngineContractCatalog, succeeding);
      await run(engine.start(slipOf('flow-1', [take, wait, settle]), 'k'));

      expect(await state(engine, 'flow-1')).toBe('waiting');
      const wrong = await run(
        Effect.flip(engine.signal('flow-1', 'elsewhere', {})),
      );
      expect(wrong._tag).toBe('FlowSignalRejected');

      await run(engine.signal('flow-1', 'await', { delivered: true }));
      expect(await state(engine, 'flow-1')).toBe('completed');

      const late = await run(Effect.flip(engine.signal('flow-1', 'await', {})));
      expect(late._tag).toBe('FlowSignalRejected');
    });

    it('interrupts a waiting flow', async () => {
      const engine = make(flowEngineContractCatalog, succeeding);
      await run(engine.start(slipOf('flow-1', [take, wait]), 'k'));

      await run(engine.interrupt('flow-1'));

      expect(await state(engine, 'flow-1')).toBe('interrupted');
    });

    it('answers FlowNotFound for a flow it never started', async () => {
      const engine = make(flowEngineContractCatalog, succeeding);

      for (const effect of [
        engine.status('nope'),
        engine.signal('nope', 'await', {}),
        engine.interrupt('nope'),
      ])
        expect((await run(Effect.flip(effect)))._tag).toBe('FlowNotFound');
    });
  });
};
