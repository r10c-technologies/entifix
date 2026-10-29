import { openStruct, registerEvent, registerMessage } from '@entifix/core';
import { Schema } from 'effect';

import { TRANSACTION_STATES, transactionEventName } from './event.js';

/**
 * The transaction-shaped messages, registered by the package that owns them —
 * core's registry is open, so these left core's closed union in 0.11.0 and are
 * deleted with the saga runner and the tracker (#127).
 *
 * Each schema names only what a reader of it branches on and keeps the rest,
 * which is enough to refuse a body that is some other message wearing this
 * one's name.
 */
const State = Schema.Literals(TRANSACTION_STATES);

export const TransactionCommandSchema = openStruct({
  transactionId: Schema.String,
  type: Schema.String,
  entity: Schema.String,
  payload: Schema.Unknown,
});

export const TransactionAcceptedSchema = openStruct({
  transactionId: Schema.String,
  state: State,
});

export const TransactionRecordSchema = openStruct({
  transactionId: Schema.String,
  entity: Schema.String,
  state: State,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export const SagaResultSchema = openStruct({
  state: Schema.String,
  outcomes: Schema.Array(Schema.Unknown),
});

export const SagaInstanceSchema = openStruct({
  sagaId: Schema.String,
  definition: Schema.String,
  state: Schema.String,
  stepIndex: Schema.Number,
  outcomes: Schema.Array(Schema.Unknown),
});

export const TransactionEventSchema = openStruct({
  transactionId: Schema.String,
  entity: Schema.String,
  state: State,
  step: Schema.Literals(['accepted', 'completed', 'failed']),
  at: Schema.String,
});

registerMessage('command', TransactionCommandSchema);
registerMessage('transactionAccepted', TransactionAcceptedSchema);
registerMessage('transactionRecord', TransactionRecordSchema);
registerMessage('sagaResult', SagaResultSchema);
registerMessage('sagaInstance', SagaInstanceSchema);

// ⚠️ Registered audience-free: a transaction event is scoped by the
// `organizationId` in its `data`, which is what the stream hub filters on
// today. The flow events that replace these carry a real audience.
for (const step of ['accepted', 'completed', 'failed'] as const)
  registerEvent(transactionEventName(step), TransactionEventSchema, {
    audience: 'none',
  });
