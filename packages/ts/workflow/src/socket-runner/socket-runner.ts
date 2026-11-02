import { NodeClusterSocket } from '@effect/platform-node';
import { Layer, Option } from 'effect';
import {
  ClusterWorkflowEngine,
  RunnerAddress,
  type ShardingConfig,
} from 'effect/cluster';

import { FlowEngineLayer } from '../engine/make-flow-engine.js';
import type { InterpreterOptions } from '../interpreter/slip-workflow.js';
import { SqlFlowStatusStoreLayer } from '../postgres/sql-flow-status-store.js';

export interface SocketRunnerOptions {
  /** Where the other runners reach this one, and where it listens. */
  readonly host: string;
  readonly port: number;
  /**
   * How quickly the runner notices a dead peer and takes its shards over —
   * the lock expiry, the assignment refresh, the storage polls. The cluster
   * defaults are tuned for a fleet that rarely loses a runner; a host may
   * shorten them, and the chaos suite does.
   */
  readonly sharding?: Partial<
    Omit<ShardingConfig.ShardingConfig['Service'], 'runnerAddress'>
  >;
}

/**
 * The flow engine as one runner among several
 * ([ADR 0016](../../../../../docs/adr/0016-a-flow-engine-port-and-a-durable-workflow-adapter.md)):
 * runners register in the shared SQL database, shards are spread between
 * them, and a runner that dies has its flows resumed by another. Every
 * replica runs this with its own port.
 */
export const SocketRunnerFlowEngineLayer = (
  options: InterpreterOptions,
  runner: SocketRunnerOptions,
) =>
  FlowEngineLayer(options).pipe(
    Layer.provide(SqlFlowStatusStoreLayer),
    Layer.provide(
      ClusterWorkflowEngine.layer.pipe(
        Layer.provide(
          NodeClusterSocket.layer({
            storage: 'sql',
            shardingConfig: {
              ...runner.sharding,
              runnerAddress: Option.some(
                RunnerAddress.make(runner.host, runner.port),
              ),
            },
          }),
        ),
      ),
    ),
  );
