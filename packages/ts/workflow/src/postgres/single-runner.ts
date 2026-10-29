import type { FragmentCatalog } from '@entifix/business/flow';
import { Layer } from 'effect';
import { ClusterWorkflowEngine, SingleRunner } from 'effect/cluster';

import { FlowEngineLayer } from '../engine/make-flow-engine.js';
import { SqlFlowStatusStoreLayer } from './sql-flow-status-store.js';

/**
 * The flow engine on one runner in this process, its journal and its status
 * in the host's SQL database — for a deployment of one replica, and for specs.
 * Needs the host's `SqlClient` and `Crypto` and a participant client.
 */
export const SingleRunnerFlowEngineLayer = (catalog: FragmentCatalog) =>
  FlowEngineLayer(catalog).pipe(
    Layer.provide(SqlFlowStatusStoreLayer),
    Layer.provide(
      ClusterWorkflowEngine.layer.pipe(
        Layer.provide(SingleRunner.layer({ runnerStorage: 'sql' })),
      ),
    ),
  );
