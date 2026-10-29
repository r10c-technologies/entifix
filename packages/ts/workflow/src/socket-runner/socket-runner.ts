import { NodeClusterSocket } from '@effect/platform-node';
import type { FragmentCatalog } from '@entifix/business/flow';
import { Layer, Option } from 'effect';
import { ClusterWorkflowEngine, RunnerAddress } from 'effect/cluster';

import { FlowEngineLayer } from '../engine/make-flow-engine.js';
import { SqlFlowStatusStoreLayer } from '../postgres/sql-flow-status-store.js';

export interface SocketRunnerOptions {
  /** Where the other runners reach this one, and where it listens. */
  readonly host: string;
  readonly port: number;
}

/**
 * The flow engine as one runner among several
 * ([ADR 0016](../../../../../docs/adr/0016-a-flow-engine-port-and-a-durable-workflow-adapter.md)):
 * runners register in the shared SQL database, shards are spread between
 * them, and a runner that dies has its flows resumed by another. Every
 * replica runs this with its own port.
 */
export const SocketRunnerFlowEngineLayer = (
  catalog: FragmentCatalog,
  runner: SocketRunnerOptions,
) =>
  FlowEngineLayer(catalog).pipe(
    Layer.provide(SqlFlowStatusStoreLayer),
    Layer.provide(
      ClusterWorkflowEngine.layer.pipe(
        Layer.provide(
          NodeClusterSocket.layer({
            storage: 'sql',
            shardingConfig: {
              runnerAddress: Option.some(
                RunnerAddress.make(runner.host, runner.port),
              ),
            },
          }),
        ),
      ),
    ),
  );
