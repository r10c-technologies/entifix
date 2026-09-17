import { type ShutdownHook, ShutdownRegistryTag } from '@entifix/business';
import { EntifixConnError } from '@entifix/core';
import {
  Duration,
  Effect,
  Layer,
  Logger,
  TestClock,
  TestContext,
} from 'effect';
import { describe, expect, it } from 'vitest';

import { defineSaga } from '../contracts/saga-definition.js';
import { SagaDispatcherTag } from '../ports/saga-dispatcher.js';
import {
  type SagaInstance,
  type SagaStore,
  SagaStoreTag,
} from '../ports/saga-store.js';
import { resumeStaleSagas, startSagaResume } from './resume-sweep.js';

/**
 * A one-step flow and a store holding instances as given.
 *
 * Local rather than `@entifix/testing-unit`'s double: this package defines the
 * ports that one implements, so importing it here would be a cycle — the choice
 * `run-saga.spec.ts` made for the same reason.
 */
const place = defineSaga({
  name: 'place',
  permission: 'orders:order:write',
  steps: [
    {
      id: 'confirm',
      participant: 'orders',
      command: { method: 'POST', path: '/confirm' },
      kind: 'pivot',
    },
  ],
});

const stuck = (
  sagaId: string,
  over: Partial<SagaInstance> = {},
): SagaInstance => ({
  sagaId,
  definition: 'place',
  state: 'RUNNING',
  stepIndex: 0,
  outcomes: [],
  inputs: { confirm: [{ body: {} }] },
  resumeAttempts: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const makeStore = (
  instances: SagaInstance[],
  options: { claimable?: (sagaId: string) => boolean; failFind?: boolean } = {},
) => {
  const settled: Array<{ sagaId: string; state: string }> = [];
  const store: SagaStore = {
    start: () => Effect.void,
    beginStep: () => Effect.void,
    recordOutcome: () => Effect.void,
    settle: (sagaId, state) =>
      Effect.sync(() => {
        settled.push({ sagaId, state });
      }),
    get: () => Effect.succeed(undefined),
    findStale: () =>
      options.failFind
        ? Effect.fail(new EntifixConnError('store down'))
        : Effect.succeed(instances),
    claimForResume: sagaId =>
      Effect.succeed(
        (options.claimable ?? (() => true))(sagaId)
          ? instances.find(entry => entry.sagaId === sagaId)
          : undefined,
      ),
    markCompensated: () => Effect.void,
  };
  return { store, settled };
};

const dispatcher = (answer: 'ok' | 'unreachable') =>
  Layer.succeed(SagaDispatcherTag, {
    dispatch: () =>
      answer === 'ok'
        ? Effect.succeed({ ok: true, status: 200, body: {} })
        : Effect.fail(new EntifixConnError('participant down')),
  });

const quiet = Logger.replace(Logger.defaultLogger, Logger.none);

const sweep = (store: SagaStore, answer: 'ok' | 'unreachable' = 'ok') =>
  Effect.runPromise(
    resumeStaleSagas({
      definitions: [place],
      staleAfterMs: 1000,
      maxResumeAttempts: 3,
    }).pipe(
      Effect.provide(Layer.succeed(SagaStoreTag, store)),
      Effect.provide(dispatcher(answer)),
      Effect.provide(quiet),
    ),
  );

describe('resumeStaleSagas', () => {
  it('finishes every stale instance it can claim', async () => {
    const { store, settled } = makeStore([stuck('s-1'), stuck('s-2')]);

    await sweep(store);

    expect(settled).toEqual([
      { sagaId: 's-1', state: 'COMPLETED' },
      { sagaId: 's-2', state: 'COMPLETED' },
    ]);
  });

  // Another replica claimed it first; walking it here too would dispatch twice.
  it('skips an instance it could not claim', async () => {
    const { store, settled } = makeStore([stuck('s-1'), stuck('s-2')], {
      claimable: sagaId => sagaId === 's-2',
    });

    await sweep(store);

    expect(settled).toEqual([{ sagaId: 's-2', state: 'COMPLETED' }]);
  });

  it('leaves an instance of a flow it does not know alone', async () => {
    const { store, settled } = makeStore([
      stuck('s-1', { definition: 'unknown' }),
      stuck('s-2'),
    ]);

    await sweep(store);

    expect(settled).toEqual([{ sagaId: 's-2', state: 'COMPLETED' }]);
  });

  it('carries on past an instance whose resume fails', async () => {
    const { store } = makeStore([stuck('s-1')]);

    await expect(sweep(store, 'unreachable')).resolves.toBeUndefined();
  });

  it('survives a store it cannot read', async () => {
    const { store } = makeStore([], { failFind: true });

    await expect(sweep(store)).resolves.toBeUndefined();
  });
});

describe('startSagaResume', () => {
  it('sweeps on its interval and stops at shutdown', async () => {
    const { store, settled } = makeStore([stuck('s-1')]);
    const hooks: ShutdownHook[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* startSagaResume({
          definitions: [place],
          staleAfterMs: 1000,
          maxResumeAttempts: 3,
          intervalMs: 5000,
        });

        // Nothing before the first interval.
        yield* TestClock.adjust(Duration.millis(4999));
        expect(settled).toEqual([]);

        yield* TestClock.adjust(Duration.millis(1));
        yield* Effect.yieldNow();
        expect(settled).toEqual([{ sagaId: 's-1', state: 'COMPLETED' }]);

        expect(hooks.map(hook => [hook.name, hook.phase])).toEqual([
          ['saga-resume-sweep', 'stop-intake'],
        ]);
        yield* hooks[0]!.run;

        yield* TestClock.adjust(Duration.millis(10_000));
        yield* Effect.yieldNow();
        expect(settled).toHaveLength(1);
      }).pipe(
        Effect.provide(Layer.succeed(SagaStoreTag, store)),
        Effect.provide(dispatcher('ok')),
        Effect.provide(
          Layer.succeed(ShutdownRegistryTag, {
            register: hook =>
              Effect.sync(() => {
                hooks.push(hook);
              }),
            terminating: Effect.succeed(false),
            drain: Effect.void,
          }),
        ),
        Effect.provide(quiet),
        Effect.provide(TestContext.TestContext),
      ),
    );
  });
});
