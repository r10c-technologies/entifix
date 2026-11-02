import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Slip } from '@entifix/business/flow';
import { Declined, Unavailable } from '@entifix/core';
import { makeInMemoryOutbox } from '@entifix/testing-unit';
import { flowEngineContractCatalog } from '@entifix/testing-unit/contracts';
import {
  type FlowEngine,
  FlowEngineTag,
  OutboxTag,
  ParticipantClientTag,
} from '@entifix/transactions';
import {
  InMemoryBulkheadLayer,
  InMemoryCircuitBreakerLayer,
  InMemoryRetryBudgetLayer,
} from '@entifix/transactions/engine';
import { Effect, Layer, ManagedRuntime, Schedule, Tracer } from 'effect';
import { WorkflowEngine } from 'effect/workflow';

import { FlowEngineLayer } from '../../src/engine/make-flow-engine.js';
import {
  FlowStatusStoreTag,
  makeInMemoryFlowStatusStore,
} from '../../src/status/flow-status-store.js';

/**
 * One recorded run: a slip, how its participants answer and which waits are
 * signalled, and the commands the interpreter issued for it — every Activity
 * with its attempt, every durable deferred it awaited, every clock it set, in
 * the order the workflow engine saw them.
 *
 * That sequence is what a journal is replayed against. A flow resumed after
 * an interpreter change replays its journal through the new code; an Activity
 * renamed or moved makes the replay re-run a call that already happened, or
 * skip one that did not. So a change to the sequence is a new `slipVersion`,
 * never an edit to the one in-flight flows were journaled under.
 */
export interface JournalCase {
  readonly name: string;
  readonly slip: Slip;
  /** `<step>:<kind>` to how the call fails; anything unlisted succeeds. */
  readonly refusals?: Readonly<Record<string, 'declined' | 'unavailable'>>;
  /** Waits signalled, by step, once the flow parks on them. */
  readonly signals?: Readonly<Record<string, unknown>>;
  readonly commands: readonly string[];
}

export interface Journal {
  readonly slipVersion: number;
  readonly cases: readonly JournalCase[];
}

const here = import.meta.dirname;

export const journalPath = (slipVersion: number) =>
  join(here, `slip-v${String(slipVersion)}.json`);

export const readJournal = (slipVersion: number): Journal =>
  JSON.parse(readFileSync(journalPath(slipVersion), 'utf8')) as Journal;

export const writeJournal = (journal: Journal) =>
  writeFileSync(
    journalPath(journal.slipVersion),
    `${JSON.stringify(journal, null, 2)}\n`,
  );

/**
 * A tracer that tells `commands` what the workflow engine was asked: every
 * Activity runs in a span named after it, and every deferred lookup and clock
 * in a span carrying the name. Spans the interpreter's own guards open are
 * not commands and are left out.
 */
const recordingTracer = (commands: string[]): Tracer.Tracer =>
  Tracer.make({
    span(options) {
      const span = Tracer.nativeTracer.span(options);
      const { name } = options;
      if (
        name === 'WorkflowEngine.deferredResult' ||
        name === 'WorkflowEngine.scheduleClock'
      ) {
        const index = commands.push(name) - 1;
        const attribute = span.attribute.bind(span);
        span.attribute = (key, value) => {
          if (key === 'name')
            commands[index] =
              `${name === 'WorkflowEngine.scheduleClock' ? 'clock' : 'deferred'} ${String(value)}`;
          attribute(key, value);
        };
      } else if (ACTIVITY.test(name)) commands.push(`activity ${name}`);
      return span;
    },
  });

/**
 * The Activity names a flow journals: the interpreter's status records,
 * announcements and calls, and a short durable sleep, which the engine runs
 * as an Activity of its own.
 */
const ACTIVITY =
  /^(status:|announce:|DurableClock\/|.+:(action|compensation)$)/;

/**
 * The flow at rest: finished, suspended, or parked on a wait the case
 * signals. A wait it does not signal is watched until its clock ends it.
 */
const settled = (
  engine: FlowEngine,
  flowId: string,
  signalled: (step: string | undefined) => boolean,
) =>
  engine.status(flowId).pipe(
    Effect.repeat({
      until: status =>
        status.state !== 'running' &&
        (status.state !== 'waiting' || signalled(status.step)),
      schedule: Schedule.spaced('5 millis'),
      times: 400,
    }),
  );

/** Runs one case through the interpreter and answers the commands it issued. */
export const recordCommands = async (
  journalCase: Omit<JournalCase, 'commands'>,
): Promise<readonly string[]> => {
  const commands: string[] = [];
  const runtime = ManagedRuntime.make(
    FlowEngineLayer({
      catalog: flowEngineContractCatalog,
      source: 'journal',
      // One segment at a time, so the sequence is one order rather than an
      // interleaving.
      dials: { concurrency: 1 },
    }).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          WorkflowEngine.layerMemory,
          Layer.succeed(Tracer.Tracer, recordingTracer(commands)),
          InMemoryCircuitBreakerLayer({ dials: { minimumCalls: 100 } }),
          InMemoryBulkheadLayer(),
          InMemoryRetryBudgetLayer(),
          Layer.succeed(FlowStatusStoreTag, makeInMemoryFlowStatusStore()),
          Layer.succeed(OutboxTag, makeInMemoryOutbox()),
          Layer.succeed(ParticipantClientTag, {
            call: ({ step, kind }) => {
              const refusal = journalCase.refusals?.[`${step.step}:${kind}`];
              if (refusal === 'declined') return Effect.fail(new Declined({}));
              if (refusal === 'unavailable')
                return Effect.fail(new Unavailable({}));
              return Effect.succeed({ id: `${step.step}-1` });
            },
          }),
        ),
      ),
    ) as Layer.Layer<FlowEngineTag>,
  );
  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const engine = yield* FlowEngineTag;
        const { flowId } = journalCase.slip;
        yield* engine.start(journalCase.slip, `journal:${flowId}`);
        const sent = new Set<string>();
        const pending = (step: string | undefined) =>
          step !== undefined &&
          journalCase.signals?.[step] !== undefined &&
          !sent.has(step);
        for (;;) {
          const status = yield* settled(engine, flowId, pending);
          if (status.state !== 'waiting' || !pending(status.step)) return;
          const step = status.step as string;
          sent.add(step);
          yield* engine.signal(flowId, step, journalCase.signals?.[step]);
        }
      }),
    );
  } finally {
    await runtime.dispose();
  }
  return [...commands];
};
