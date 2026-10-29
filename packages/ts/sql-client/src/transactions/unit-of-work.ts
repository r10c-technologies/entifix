import { Contention, isStoreFault, type StoreFault } from '@entifix/core';
import type {
  OutboxEvent,
  UnitClaim,
  UnitOfWork,
  UnitOutcome,
  UnitRunOptions,
} from '@entifix/transactions';
import { Data, Effect, Option, Schedule } from 'effect';
import { type SqlClient, SqlError } from 'effect/sql';

import { translateSqlError } from '../errors/translate-sql-error.js';
import { outboxRow } from './outbox.js';

/** What a unit's body writes through: the client, inside the unit's transaction. */
export interface SqlUnit {
  readonly sql: SqlClient.SqlClient;
}

/** The claim was taken, or an emitted event was already recorded: roll back. */
class Duplicate extends Data.TaggedError('SqlUnitDuplicate') {}

/** The body refused with a business failure: roll back, and answer it. */
class Aborted extends Data.TaggedError('SqlUnitAborted')<{
  readonly reason: unknown;
}> {}

/** A serialization failure or a deadlock: the whole unit runs again. */
const ATTEMPTS = 3;
const BACK_OFF = Schedule.exponential('20 millis');

const claimed = (sql: SqlClient.SqlClient, claim: UnitClaim) =>
  claim.kind === 'event'
    ? sql<{ readonly event_id: string }>`
        INSERT INTO entifix_inbox (consumer, event_id)
        VALUES (${claim.consumer}, ${claim.eventId})
        ON CONFLICT DO NOTHING RETURNING event_id`
    : sql<{ readonly command_id: string }>`
        INSERT INTO entifix_command_inbox (command_id)
        VALUES (${claim.commandId})
        ON CONFLICT DO NOTHING RETURNING command_id`;

const readReplay = (sql: SqlClient.SqlClient, commandId: string) =>
  sql<{ readonly replay: unknown }>`
    SELECT replay FROM entifix_command_inbox WHERE command_id = ${commandId}`.pipe(
    Effect.map(([row]) =>
      row === undefined || row.replay == null
        ? Option.none()
        : Option.some(
            typeof row.replay === 'string'
              ? (JSON.parse(row.replay) as unknown)
              : row.replay,
          ),
    ),
    Effect.mapError(error => translateSqlError(error) as StoreFault),
  );

/**
 * Units of work over one SQL database
 * ([ADR 0009](../../../../../docs/adr/0009-a-unit-of-work-the-outbox-inbox-and-command-claim-join.md)):
 * the body's writes, the events it emitted and its claim are one transaction.
 * A taken claim, or an event id the outbox already holds, rolls back and
 * answers `duplicate`; a business failure rolls back and answers `aborted`; a
 * store failure is an error; a serialization failure runs the whole unit again,
 * body included, which is why the body must be retry-safe.
 */
export const makeSqlUnitOfWork = (
  sql: SqlClient.SqlClient,
): UnitOfWork<SqlUnit> => {
  const attempt = <A, E, R>(
    body: (unit: {
      readonly handle: SqlUnit;
      emit(event: OutboxEvent): void;
    }) => Effect.Effect<A, E, R>,
    options: UnitRunOptions<A, R> | undefined,
  ) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const claim = options?.claim;
          if (claim !== undefined) {
            const rows = yield* claimed(sql, claim);
            if (rows.length === 0) return yield* Effect.fail(new Duplicate());
          }

          const emitted: OutboxEvent[] = [];
          const value = yield* body({
            handle: { sql },
            emit: event => void emitted.push(event),
          }).pipe(
            // The body's own driver failure is translated first: an outage
            // fails the unit, while a unique violation is the refusal it would
            // be from any adapter, and aborts it.
            Effect.mapError(failure => {
              const translated = SqlError.isSqlError(failure)
                ? translateSqlError(failure)
                : failure;
              return isStoreFault(translated)
                ? translated
                : new Aborted({ reason: translated });
            }),
          );

          if (emitted.length > 0) {
            const written = yield* sql<{ readonly event_id: string }>`
              INSERT INTO entifix_outbox ${sql.insert(emitted.map(outboxRow))}
              ON CONFLICT (event_id) DO NOTHING RETURNING event_id`;
            // An event id already recorded is the outbox's own idempotency
            // claim: what it announces committed before.
            if (written.length < emitted.length)
              return yield* Effect.fail(new Duplicate());
          }

          if (claim?.kind === 'command' && options?.replay !== undefined)
            yield* sql`
              UPDATE entifix_command_inbox
              SET replay = ${JSON.stringify(options.replay(value))}::jsonb
              WHERE command_id = ${claim.commandId}`;
          return value;
        }),
      )
      .pipe(
        Effect.map(
          value =>
            ({ _tag: 'committed', value }) as UnitOutcome<
              A,
              Exclude<E, StoreFault>
            >,
        ),
        Effect.catch(failure =>
          failure instanceof Duplicate
            ? Effect.map(
                options?.claim?.kind === 'command'
                  ? readReplay(sql, options.claim.commandId)
                  : Effect.succeed(Option.none()),
                replay =>
                  ({ _tag: 'duplicate', replay }) as UnitOutcome<
                    A,
                    Exclude<E, StoreFault>
                  >,
              )
            : failure instanceof Aborted
              ? Effect.succeed({
                  _tag: 'aborted',
                  reason: failure.reason as Exclude<E, StoreFault>,
                } as UnitOutcome<A, Exclude<E, StoreFault>>)
              : // What reaches here is the transaction's own failure — a
                // connection lost, a serialization conflict at commit. A
                // unique violation cannot: the claim and the outbox insert
                // both read a conflict as a duplicate, and the body's own is
                // aborted above.
                Effect.fail(translateSqlError(failure) as StoreFault),
        ),
      );

  return {
    run: (body, options) =>
      Effect.gen(function* () {
        const outcome = yield* attempt(body, options).pipe(
          Effect.retry({
            times: ATTEMPTS - 1,
            while: failure => failure instanceof Contention,
            schedule: BACK_OFF,
          }),
        );
        if (outcome._tag === 'committed' && options?.afterCommit)
          yield* options.afterCommit.pipe(Effect.ignore);
        return outcome;
      }),
    replay: commandId => readReplay(sql, commandId),
  };
};
