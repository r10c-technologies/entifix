import { ShutdownRegistryTag } from '@entifix/business';
import { Duration, Effect, Fiber } from 'effect';

import type { SagaDefinition } from '../contracts/saga-definition.js';
import { SagaDispatcherTag } from '../ports/saga-dispatcher.js';
import { SagaStoreTag } from '../ports/saga-store.js';
import { resumeSaga } from './run-saga.js';

export interface ResumeSweepOptions {
  /** Every flow this process can finish, by `definition.name`. */
  readonly definitions: readonly SagaDefinition[];
  /**
   * How long an instance may sit untouched before its coordinator is presumed
   * gone.
   *
   * ⚠️ **Must stay above the longest a step legitimately takes.** `updatedAt`
   * is re-stamped before every dispatch, so a slow participant keeps an instance
   * fresh — but a step slower than this window is resumed underneath the
   * coordinator still waiting on it, and only the participants' inboxes stop
   * that from being two side effects.
   */
  readonly staleAfterMs: number;
  /** Past this many sweeps, an instance settles `STRANDED` instead. */
  readonly maxResumeAttempts: number;
}

/**
 * One pass: find the instances nobody finished, claim each, and finish it.
 *
 * ⚠️ **`findStale` then `claimForResume`, never `findStale` then resume.** The
 * claim is a conditional write, so an instance another replica already took no
 * longer matches and is skipped. Without it two sweepers would walk one flow
 * together, and the attempt ceiling would count two attempts per tick.
 *
 * Failures are logged, per instance and around the pass, never raised: one flow
 * that cannot be resumed must not abandon the flows behind it, and a store that
 * is briefly unreachable must not kill the daemon that calls this.
 */
export const resumeStaleSagas = ({
  definitions,
  staleAfterMs,
  maxResumeAttempts,
}: ResumeSweepOptions): Effect.Effect<
  void,
  never,
  SagaStoreTag | SagaDispatcherTag
> =>
  Effect.gen(function* () {
    const store = yield* SagaStoreTag;
    const byName = new Map(
      definitions.map(definition => [definition.name, definition]),
    );

    for (const found of yield* store.findStale(staleAfterMs)) {
      const definition = byName.get(found.definition);
      if (definition === undefined) {
        // Nothing here can finish a flow it cannot read, and settling it would
        // be a guess about its steps — so it is surfaced and left alone.
        yield* Effect.logError('stale saga names an unknown definition').pipe(
          Effect.annotateLogs({
            sagaId: found.sagaId,
            definition: found.definition,
          }),
        );
        continue;
      }

      const claimed = yield* store.claimForResume(found.sagaId, staleAfterMs);
      if (claimed === undefined) continue;

      yield* resumeSaga({
        instance: claimed,
        definition,
        maxResumeAttempts,
      }).pipe(
        Effect.tap(result =>
          Effect.logInfo('resumed a saga instance').pipe(
            Effect.annotateLogs({
              sagaId: claimed.sagaId,
              definition: claimed.definition,
              resumedFrom: claimed.state,
              settled: result.state,
            }),
          ),
        ),
        Effect.catchAll(error =>
          Effect.logError('resuming a saga instance failed').pipe(
            Effect.annotateLogs({
              sagaId: claimed.sagaId,
              error: String(error),
            }),
          ),
        ),
      );
    }
  }).pipe(
    Effect.catchAll(error =>
      Effect.logError('saga resume sweep failed').pipe(
        Effect.annotateLogs({ error: String(error) }),
      ),
    ),
  );

/**
 * Runs {@link resumeStaleSagas} every `intervalMs` as a daemon, and stops it on
 * shutdown.
 *
 * `stop-intake`, not `flush`: the sweep writes the store and dispatches, so it
 * has to stop before the clients it goes through do.
 */
export const startSagaResume = (
  options: ResumeSweepOptions & { readonly intervalMs: number },
): Effect.Effect<
  void,
  never,
  SagaStoreTag | SagaDispatcherTag | ShutdownRegistryTag
> =>
  Effect.gen(function* () {
    const store = yield* SagaStoreTag;
    const dispatcher = yield* SagaDispatcherTag;
    const shutdown = yield* ShutdownRegistryTag;

    // Resolved once at boot and provided to every pass, so the daemon needs
    // nothing from the context it outlives.
    const pass = resumeStaleSagas(options).pipe(
      Effect.provideService(SagaStoreTag, store),
      Effect.provideService(SagaDispatcherTag, dispatcher),
    );

    const daemon = yield* Effect.forkDaemon(
      pass.pipe(
        Effect.delay(Duration.millis(options.intervalMs)),
        Effect.forever,
      ),
    );

    yield* shutdown.register({
      name: 'saga-resume-sweep',
      phase: 'stop-intake',
      run: Fiber.interrupt(daemon).pipe(Effect.asVoid),
    });
  });
