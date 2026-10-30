import { translateSqlError } from '@entifix/sql';
import type { FlowState } from '@entifix/transactions';
import { Effect, Layer, Option } from 'effect';
import { SqlClient } from 'effect/sql';

import {
  type FlowRecord,
  type FlowStatusStore,
  FlowStatusStoreTag,
} from '../status/flow-status-store.js';

// A type alias, not an interface: a row must be assignable to the record a
// driver hands back, and an interface has no index signature.
type FlowStatusRow = {
  readonly flow_id: string;
  readonly execution_id: string;
  readonly state: FlowState;
  readonly step: string | null;
  readonly waiting_for: string | null;
  readonly correlation: string | null;
};

const recordOf = (row: FlowStatusRow): FlowRecord => ({
  flowId: row.flow_id,
  executionId: row.execution_id,
  state: row.state,
  ...(row.step === null ? {} : { step: row.step }),
  ...(row.waiting_for === null ? {} : { waitingFor: row.waiting_for }),
  ...(row.correlation === null ? {} : { correlation: row.correlation }),
});

const fault = (error: unknown) => translateSqlError(error);

/** Creates the flow status table if it is missing. Idempotent. */
export const ensureFlowStatusTable = (sql: SqlClient.SqlClient) =>
  sql`
    CREATE TABLE IF NOT EXISTS entifix_flow_status (
      flow_id text PRIMARY KEY,
      idempotency_key text NOT NULL UNIQUE,
      execution_id text NOT NULL,
      state text NOT NULL,
      step text,
      waiting_for text,
      correlation text
    )`.pipe(Effect.asVoid, Effect.mapError(fault));

/**
 * The flow status store over SQL, beside the workflow engine's own tables. A
 * registration inserts under the key or answers the flow already there, in one
 * statement and a read.
 */
export const makeSqlFlowStatusStore = (
  sql: SqlClient.SqlClient,
): FlowStatusStore => ({
  register: (key, record) =>
    Effect.gen(function* () {
      const [inserted] = yield* sql<FlowStatusRow>`
        INSERT INTO entifix_flow_status
          (flow_id, idempotency_key, execution_id, state)
        VALUES (${record.flowId}, ${key}, ${record.executionId}, ${record.state})
        ON CONFLICT DO NOTHING
        RETURNING *`;
      if (inserted !== undefined) return recordOf(inserted);
      const [existing] = yield* sql<FlowStatusRow>`
        SELECT * FROM entifix_flow_status
        WHERE idempotency_key = ${key} OR flow_id = ${record.flowId}`;
      // Gone between the two statements cannot happen: nothing deletes a flow.
      return recordOf(existing as FlowStatusRow);
    }).pipe(Effect.mapError(fault)),

  find: flowId =>
    sql<FlowStatusRow>`
      SELECT * FROM entifix_flow_status WHERE flow_id = ${flowId}`.pipe(
      Effect.map(([row]) =>
        row === undefined ? Option.none() : Option.some(recordOf(row)),
      ),
      Effect.mapError(fault),
    ),

  findByCorrelation: correlation =>
    sql<FlowStatusRow>`
      SELECT * FROM entifix_flow_status
      WHERE correlation = ${correlation}`.pipe(
      Effect.map(([row]) =>
        row === undefined ? Option.none() : Option.some(recordOf(row)),
      ),
      Effect.mapError(fault),
    ),

  update: (flowId, patch) =>
    sql`
      UPDATE entifix_flow_status
      SET state = ${patch.state}, step = ${patch.step ?? null},
          waiting_for = ${patch.waitingFor ?? null},
          correlation = ${patch.correlation ?? null}
      WHERE flow_id = ${flowId}`.pipe(Effect.asVoid, Effect.mapError(fault)),
});

/** The SQL status store, its table ensured as the layer builds. */
export const SqlFlowStatusStoreLayer = Layer.effect(
  FlowStatusStoreTag,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* ensureFlowStatusTable(sql);
    return makeSqlFlowStatusStore(sql);
  }),
);
