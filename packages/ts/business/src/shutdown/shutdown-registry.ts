import { Cause, Context, Effect } from 'effect';

/**
 * The order a shutdown runs in.
 *
 * **`stop-intake`** stops the process taking new work — cancelling the bus's
 * consumers, interrupting a polling daemon. **`flush`** carries out what is
 * already committed but not yet delivered: the outbox relay's final pass. The
 * two are separate phases rather than one list because they are ordered against
 * each other and not merely against the connections closing — flushing while
 * consumers are still folding events would race a drain against fresh work, and
 * the relay would go on finding entries the handlers keep writing.
 */
export const SHUTDOWN_PHASES = ['stop-intake', 'flush'] as const;

export type ShutdownPhase = (typeof SHUTDOWN_PHASES)[number];

/**
 * One thing to do before this process's connections close.
 *
 * `run` is fully applied, exactly like `HealthProbe.check`: whoever
 * registers the hook has already closed over the connector, the fiber or the
 * store, so the drain can run every hook without knowing what any of them
 * touches.
 */
export interface ShutdownHook {
  /** Logged when the hook runs, and when it fails. Never rendered to a caller. */
  readonly name: string;
  readonly phase: ShutdownPhase;
  readonly run: Effect.Effect<void>;
}

/**
 * How long one hook may take before the drain moves on without it.
 *
 * Not belt-and-braces. Kubernetes sends SIGKILL at the end of
 * `terminationGracePeriodSeconds` whatever the process is doing, so an
 * unbounded hook does not buy time — it spends the budget of the hooks behind
 * it and then loses them entirely. A hook that cannot finish in time has
 * already failed; the difference is whether the *next* one gets to run.
 */
const HOOK_TIMEOUT = '10 seconds';

/**
 * What a service does on its way out, registered by whoever opened the thing
 * that needs draining.
 *
 * A sibling of `HealthRegistry` and `WiringRegistry`, and for the same reason:
 * a `-service` that gains a bus gains its consumer drain by merging that
 * adapter's layer, and nothing in the service's own `main.ts` has to remember
 * to list it. A hand-written sequence per composition root drifts the first
 * time someone adds a dependency; this cannot, because the hook ships with the
 * client that needs it.
 */
export interface ShutdownRegistry {
  /** Add a hook. Called by an adapter layer as it constructs its client. */
  readonly register: (hook: ShutdownHook) => Effect.Effect<void>;
  /**
   * Whether this process has begun terminating.
   *
   * Read by `GET /api/health/ready`, which answers `503` from here **before**
   * it consults any probe: nothing is failing, the process is leaving.
   */
  readonly terminating: Effect.Effect<boolean>;
  /**
   * Run every hook, phase by phase, in registration order. Never fails.
   *
   * Called from a `Layer` finalizer, which is what orders it: the drain layer
   * is built after the composition root, so it is released before it, and the
   * connections a hook needs are still open while it runs.
   */
  readonly drain: Effect.Effect<void>;
}

/**
 * DI tag for the shutdown registry.
 *
 * In the contract layer beside `HealthRegistryTag` so an
 * `entifix-ts-*-client` package can register a hook without depending on a
 * shell.
 */
/**
 * What a drain did, for the host to log
 * ([ADR 0013](../../../../../docs/adr/0013-failures-are-typed-values-decided-at-the-shell.md)):
 * the registry says it, the shell that made it decides how loud.
 */
export type ShutdownOutcome =
  | { readonly _tag: 'draining'; readonly hooks: number }
  | {
      readonly _tag: 'hookFailed';
      readonly hook: string;
      readonly phase: ShutdownPhase;
      /** `Cause.pretty`: a timeout and a failure stay distinguishable. */
      readonly cause: string;
    }
  | { readonly _tag: 'drained' };

/** Where a drain reports what it did. */
export type ShutdownOutcomeSink = (
  outcome: ShutdownOutcome,
) => Effect.Effect<void>;

export class ShutdownRegistryTag extends Context.Service<
  ShutdownRegistryTag,
  ShutdownRegistry
>()('ShutdownRegistryTag') {}

/**
 * Runs one hook and swallows whatever it does.
 *
 * A failure and a timeout are reported the same way on purpose: both mean this
 * hook did not do its job, both leave the ones behind it still worth running,
 * and neither is something a terminating process can act on. `Cause.pretty`
 * keeps them distinguishable for whoever reads the log the host writes.
 */
const runHook =
  (report: ShutdownOutcomeSink) =>
  (hook: ShutdownHook): Effect.Effect<void> =>
    hook.run.pipe(
      Effect.timeout(HOOK_TIMEOUT),
      Effect.catchCause(cause =>
        report({
          _tag: 'hookFailed',
          hook: hook.name,
          phase: hook.phase,
          cause: Cause.pretty(cause),
        }),
      ),
    );

/**
 * Builds the registry and the synchronous latch that flips it.
 *
 * Two halves for two callers, the `makeAmqpConnector` shape: the
 * `registry` goes into the layer graph, while `begin` is called from a
 * `process.on('SIGTERM')` handler — outside Effect, in the same tick the
 * runtime starts interrupting — so `/api/health/ready` stops claiming to be
 * ready the instant the signal lands rather than whenever the finalizers get
 * around to running.
 */
export const makeShutdownRegistry = (
  report: ShutdownOutcomeSink = () => Effect.void,
): {
  registry: ShutdownRegistry;
  begin: () => void;
} => {
  const hooks: ShutdownHook[] = [];
  let terminating = false;

  const registry: ShutdownRegistry = {
    register: hook =>
      Effect.sync(() => {
        hooks.push(hook);
      }),

    terminating: Effect.sync(() => terminating),

    drain: Effect.gen(function* () {
      terminating = true;
      yield* report({ _tag: 'draining', hooks: hooks.length });
      for (const phase of SHUTDOWN_PHASES) {
        // Sequential, and in registration order: `stop-intake` before `flush`
        // is the whole contract, and within a phase a later hook may depend on
        // an earlier one having stopped.
        yield* Effect.forEach(
          hooks.filter(hook => hook.phase === phase),
          runHook(report),
          { discard: true },
        );
      }
      yield* report({ _tag: 'drained' });
    }),
  };

  return {
    registry,
    begin: () => {
      terminating = true;
    },
  };
};
