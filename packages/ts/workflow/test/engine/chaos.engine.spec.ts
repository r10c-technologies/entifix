import { afterEach, describe, expect, it } from 'vitest';

import {
  type Call,
  type ChaosWorld,
  chaosWorld,
  eventually,
  slipOf,
  step,
} from './harness.js';

/*
 * The chaos suite (ADR 0016): the cluster workflow engine on two runner
 * processes over a real Postgres, made to fail the ways a fleet does. Fakes
 * cannot show a race, and the engine has had concurrency
 * defects closed only shortly before the pinned release, so every interpreter
 * change and every bump of the `effect` pin runs this.
 */

const CASE_MS = 120_000;

let world: ChaosWorld | undefined;
afterEach(async context => {
  if (world === undefined) return;
  if (context.task.result?.state === 'fail') console.error(world.logs());
  await world.dispose();
  world = undefined;
});

const open = async (options?: { readonly breakKey?: boolean }) => {
  world = await chaosWorld(options);
  await world.start('a');
  await world.start('b');
  return world;
};

const of = (calls: readonly Call[], name: string, kind = 'action') =>
  calls.filter(call => call.step === name && call.kind === kind);

const settled = (chaos: ChaosWorld, flowId: string, state: string) =>
  eventually(
    () => chaos.status(flowId),
    status => status?.state === state,
  );

describe('the cluster engine on two runners over Postgres', () => {
  it(
    'completes a wait signalled as it parks, and one signalled after it went idle',
    async () => {
      const chaos = await open();
      const steps = [step('hold'), step('take'), step('await'), step('settle')];
      await chaos.control('a', '/start', {
        slip: slipOf('now', steps),
        key: 'k-now',
      });
      await chaos.control('a', '/start', {
        slip: slipOf('idle', steps),
        key: 'k-idle',
      });

      await settled(chaos, 'now', 'waiting');
      // Through the other runner, while the flow is still suspending.
      expect(
        (
          await chaos.control('b', '/signal', {
            flowId: 'now',
            token: 'await',
            outcome: {},
          })
        ).status,
      ).toBe(200);
      await settled(chaos, 'idle', 'waiting');
      // Past the entity's idle time, so the flow is no longer resident.
      await new Promise(resolve => setTimeout(resolve, 2_500));
      await chaos.control('b', '/signal', {
        flowId: 'idle',
        token: 'await',
        outcome: {},
      });

      await settled(chaos, 'now', 'completed');
      await settled(chaos, 'idle', 'completed');
      for (const flowId of ['now', 'idle']) {
        expect(of(await chaos.calls(flowId), 'settle')).toHaveLength(1);
        expect(await chaos.duplicatedEffects(flowId)).toEqual([]);
      }
    },
    CASE_MS,
  );

  it(
    'lets a durable race’s clock win without waking a parked sibling',
    async () => {
      const chaos = await open();
      await chaos.control('a', '/start', {
        slip: slipOf('timed', [
          step('take'),
          step('await', { timeoutMs: 1_500 }),
          step('settle'),
        ]),
        key: 'k-timed',
      });
      await chaos.control('b', '/start', {
        slip: slipOf('parked', [step('take'), step('await'), step('settle')]),
        key: 'k-parked',
      });

      await settled(chaos, 'timed', 'suspended');
      expect(await chaos.status('parked')).toMatchObject({ state: 'waiting' });

      await chaos.control('a', '/signal', {
        flowId: 'parked',
        token: 'await',
        outcome: {},
      });
      const late = await chaos.control('b', '/signal', {
        flowId: 'timed',
        token: 'await',
        outcome: {},
      });

      await settled(chaos, 'parked', 'completed');
      expect(late).toEqual({
        status: 409,
        body: { tag: 'FlowSignalRejected' },
      });
      expect(await chaos.status('timed')).toEqual({
        state: 'suspended',
        step: 'await',
      });
      expect(of(await chaos.calls('timed'), 'settle')).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'resumes a step whose runner was killed mid-call once, on the other runner',
    async () => {
      const chaos = await open();
      await chaos.control('a', '/start', {
        slip: slipOf('killed', [
          step('hold', { chaos: 'block-first' }),
          step('take'),
          step('settle'),
        ]),
        key: 'k-killed',
      });
      const [blocked] = await eventually(
        () => chaos.calls('killed'),
        calls => calls.length === 1,
      );
      const holder = blocked?.runner as string;
      await chaos.kill(holder);

      await settled(chaos, 'killed', 'completed');
      const calls = await chaos.calls('killed');
      const other = holder === 'a' ? 'b' : 'a';
      expect(of(calls, 'hold').map(call => call.runner)).toEqual([
        holder,
        other,
      ]);
      expect(of(calls, 'take').map(call => call.runner)).toEqual([other]);
      expect(of(calls, 'settle')).toHaveLength(1);
      expect(await chaos.duplicatedEffects('killed')).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'resumes a flow after every runner was killed and started again',
    async () => {
      const chaos = await open();
      await chaos.control('b', '/start', {
        slip: slipOf('restart', [
          step('hold'),
          step('take', { chaos: 'block-first' }),
          step('settle'),
        ]),
        key: 'k-restart',
      });
      await eventually(
        () => chaos.calls('restart'),
        calls => of(calls, 'take').length === 1,
      );
      await chaos.kill('a');
      await chaos.kill('b');
      await chaos.start('a');
      await chaos.start('b');

      await settled(chaos, 'restart', 'completed');
      const calls = await chaos.calls('restart');
      expect(of(calls, 'hold')).toHaveLength(1);
      expect(of(calls, 'take')).toHaveLength(2);
      expect(of(calls, 'settle')).toHaveLength(1);
      expect(await chaos.duplicatedEffects('restart')).toEqual([]);
    },
    CASE_MS,
  );

  const doubleDelivery = async (chaos: ChaosWorld) => {
    await chaos.control('a', '/start', {
      slip: slipOf('twice', [
        step('hold'),
        step('take', { chaos: 'die-after-apply' }),
        step('settle'),
      ]),
      key: 'k-twice',
    });
    const calls = await eventually(
      () => chaos.calls('twice'),
      found => of(found, 'take').length === 1,
    );
    const holder = of(calls, 'take')[0]?.runner as string;
    await chaos.exited(holder);
    await settled(chaos, 'twice', 'completed');
    return holder;
  };

  it(
    'applies a call delivered twice once, by its idempotency key',
    async () => {
      const chaos = await open();
      const holder = await doubleDelivery(chaos);

      const calls = await chaos.calls('twice');
      expect(of(calls, 'take').map(call => call.runner)).toEqual([
        holder,
        holder === 'a' ? 'b' : 'a',
      ]);
      expect(await chaos.duplicatedEffects('twice')).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'catches a key that changes per delivery (planted)',
    async () => {
      const chaos = await open({ breakKey: true });
      await doubleDelivery(chaos);

      expect(await chaos.duplicatedEffects('twice')).toEqual(['take:action']);
    },
    CASE_MS,
  );

  it(
    'starts one flow for one key, however many starts race on two runners',
    async () => {
      const chaos = await open();
      const steps = [step('hold'), step('take'), step('settle')];
      const answers = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          chaos.control(index % 2 === 0 ? 'a' : 'b', '/start', {
            slip: slipOf(`race-${String(index)}`, steps),
            key: 'k-race',
          }),
        ),
      );

      const flowIds = new Set(answers.map(answer => answer.body['flowId']));
      expect(answers.every(answer => answer.status === 200)).toBe(true);
      expect(flowIds.size).toBe(1);
      const [winner] = [...flowIds] as string[];
      await settled(chaos, winner as string, 'completed');
      const calls = await chaos.calls(winner as string);
      expect(calls.map(call => call.step)).toEqual(['hold', 'take', 'settle']);
      for (let index = 0; index < 12; index += 1)
        if (`race-${String(index)}` !== winner)
          expect(await chaos.calls(`race-${String(index)}`)).toEqual([]);
    },
    CASE_MS,
  );
});
