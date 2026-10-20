import { Context } from 'effect';

import type { TransactionCommand } from '../contracts/command.js';
import type { LockHandle } from '../ports/lock-service.js';
import type { TransactionOutcome } from '../ports/transaction-handler.js';

/**
 * The runtime inputs the facade use-cases yield — the transaction analogue of
 * `EntityTag`/`EntityIdTag`. The engine provides them at the right moment
 * (`LockHandlesTag` after `lock`, `OutcomeTag` before `rollback`).
 */
export class CommandTag extends Context.Service<
  CommandTag,
  TransactionCommand
>()('TransactionCommandTag') {}

export class LockHandlesTag extends Context.Service<
  LockHandlesTag,
  readonly LockHandle[]
>()('LockHandlesTag') {}

export class OutcomeTag extends Context.Service<
  OutcomeTag,
  TransactionOutcome | undefined
>()('TransactionOutcomeTag') {}
