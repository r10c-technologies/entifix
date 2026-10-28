import {
  Contention,
  type DomainEvent,
  isFailure,
  isStoreFault,
  type StoreFault,
} from '@entifix/core';
import type {
  UnitClaim,
  UnitOfWork,
  UnitOutcome,
  UnitRunOptions,
} from '@entifix/transactions';
import { Context, Effect, Layer, Option, Result, Schedule } from 'effect';
import type { ClientSession, Db } from 'mongodb';

import { translateMongoFault } from '../errors/translate-mongo-error.js';
import {
  ensureInboxIndexes,
  INBOX_COLLECTION,
  inboxDocument,
  isDuplicateKey,
} from '../inbox/store.js';
import {
  MongoClientTag,
  MongoDatabaseTag,
} from '../mongo-database/mongo-database.js';
import {
  ensureOutboxIndexes,
  OUTBOX_COLLECTION,
  outboxDocument,
} from '../outbox/store.js';
import {
  COMMAND_INBOX_COLLECTION,
  commandClaimDocument,
  ensureCommandInboxIndexes,
  readCommandReplay,
  rememberCommandReplay,
} from './command-inbox.js';

/**
 * What a Mongo unit's body writes through: the database and the session bound
 * to the unit's transaction. Every write must pass `{ session }`, or it is not
 * part of the unit.
 */
export interface MongoUnit {
  readonly db: Db;
  readonly session: ClientSession;
}

/** What starts a session — a `MongoClient`, structurally. */
export interface MongoSessionSource {
  startSession(): ClientSession;
}

/**
 * How many times a unit runs before a transient conflict is reported as the
 * failure it is, and how long it waits between runs.
 *
 * Measured against a real replica set: eight units incrementing one document
 * at once conflict on every attempt but one, so a short fixed retry count
 * starves most of them. A jittered exponential back-off spreads the reruns so
 * each eventually runs alone.
 */
const ATTEMPTS = 10;
const BACK_OFF = Schedule.exponential('5 millis', 1.5).pipe(Schedule.jittered);

const hasErrorLabel = (error: unknown, label: string): boolean => {
  const candidate = error as {
    hasErrorLabel?: (label: string) => boolean;
    errorLabels?: readonly string[];
  } | null;
  return (
    candidate?.hasErrorLabel?.(label) ??
    candidate?.errorLabels?.includes(label) ??
    false
  );
};

/**
 * Whether a server label is on `error` or anywhere in its cause chain — a
 * driver error reaches here wrapped once by the adapter and possibly again by
 * the body that called the driver.
 */
const labelledInChain = (error: unknown, label: string): boolean => {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth += 1) {
    if (hasErrorLabel(current, label)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};

/** A transient conflict, which reruns the whole unit. */
const isTransient = (error: unknown): boolean =>
  isFailure(error) && error._tag === 'Contention';

const fault = (error: unknown): StoreFault => translateMongoFault(error);

const driver = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: fault });

/** A duplicate-key rejection answered as `duplicate` rather than as an error. */
const insertOrDuplicate = (run: () => Promise<unknown>) =>
  Effect.tryPromise({
    try: async () => {
      try {
        await run();
        return 'inserted' as const;
      } catch (error) {
        if (isDuplicateKey(error)) return 'duplicate' as const;
        throw error;
      }
    },
    catch: fault,
  });

const takeClaim = (db: Db, session: ClientSession, claim: UnitClaim) =>
  claim.kind === 'event'
    ? insertOrDuplicate(() =>
        db
          .collection(INBOX_COLLECTION)
          .insertOne(inboxDocument(claim.consumer, claim.eventId), {
            session,
          }),
      )
    : insertOrDuplicate(() =>
        db
          .collection(COMMAND_INBOX_COLLECTION)
          .insertOne(commandClaimDocument(claim.commandId), { session }),
      );

/**
 * Commits, retrying a commit whose result the server could not report. Such a
 * commit may or may not have applied, and Mongo makes retrying it safe.
 */
/**
 * Retried on the **driver's** error, before translation: the label that says
 * the commit's result is unknown lives on it, and a translated failure no
 * longer carries it.
 */
const commit = (session: ClientSession) =>
  Effect.tryPromise({
    try: () => session.commitTransaction(),
    catch: error => error,
  }).pipe(
    Effect.retry({
      times: ATTEMPTS - 1,
      while: error => labelledInChain(error, 'UnknownTransactionCommitResult'),
    }),
    Effect.mapError(fault),
  );

/** Rolls back, and never fails: the unit is already ending for another reason. */
const abort = (session: ClientSession) =>
  driver(() => session.abortTransaction()).pipe(Effect.ignore);

type Decision<A> =
  | { readonly kind: 'commit'; readonly value: A }
  | { readonly kind: 'duplicate' };

/**
 * A {@link UnitOfWork} per database, sharing one client — the shape a
 * per-organization store needs, where the database is resolved inside the
 * request. Each database's indexes are ensured once, before its first unit.
 */
export const makeMongoUnitsOfWork = (client: MongoSessionSource) => {
  const ensured = new Map<string, Promise<void>>();

  const ensureIndexes = (db: Db) =>
    Effect.suspend(() => {
      const key = db.databaseName;
      const done = ensured.get(key);
      if (done !== undefined) {
        return driver(() => done);
      }
      const pending = Effect.runPromise(
        Effect.all([
          ensureOutboxIndexes(db),
          ensureInboxIndexes(db),
          ensureCommandInboxIndexes(db),
        ]),
      ).then(() => undefined);
      ensured.set(key, pending);
      // A failed ensure must be retried by the next unit, not remembered.
      pending.catch(() => ensured.delete(key));
      return driver(() => pending);
    });

  const forDatabase = (db: Db): UnitOfWork<MongoUnit> => {
    const attempt = <A, E, R>(
      body: (unit: {
        readonly handle: MongoUnit;
        emit(event: DomainEvent): void;
      }) => Effect.Effect<A, E, R>,
      options: UnitRunOptions<A, R> | undefined,
    ) =>
      Effect.acquireUseRelease(
        Effect.sync(() => client.startSession()),
        session =>
          Effect.gen(function* () {
            yield* Effect.try({
              try: () => session.startTransaction(),
              catch: fault,
            });

            const work = Effect.gen(function* () {
              const claim = options?.claim;
              if (
                claim &&
                (yield* takeClaim(db, session, claim)) === 'duplicate'
              ) {
                return { kind: 'duplicate' } as Decision<A>;
              }

              const emitted: DomainEvent[] = [];
              const value = yield* body({
                handle: { db, session },
                emit: event => void emitted.push(event),
              });

              if (emitted.length > 0) {
                const written = yield* insertOrDuplicate(() =>
                  db
                    .collection(OUTBOX_COLLECTION)
                    .insertMany(emitted.map(outboxDocument), { session }),
                );
                // An event id already recorded is the outbox's own
                // idempotency claim: what it announces committed before.
                if (written === 'duplicate') {
                  return { kind: 'duplicate' } as Decision<A>;
                }
              }

              if (claim?.kind === 'command' && options?.replay) {
                const replay = options.replay(value);
                yield* driver(() =>
                  rememberCommandReplay(db, session, claim.commandId, replay),
                );
              }
              return { kind: 'commit', value } as Decision<A>;
            });

            const decided = yield* Effect.result(work);

            if (Result.isFailure(decided)) {
              yield* abort(session);
              const failure = decided.failure;
              if (isStoreFault(failure)) {
                return yield* Effect.fail(failure);
              }
              // A conflict the body surfaced without translating is still the
              // store's, not a business decision: it is retried, not aborted.
              if (labelledInChain(failure, 'TransientTransactionError')) {
                return yield* Effect.fail(new Contention());
              }
              return {
                _tag: 'aborted',
                reason: failure as Exclude<E, StoreFault>,
              } as UnitOutcome<A, Exclude<E, StoreFault>>;
            }

            if (decided.success.kind === 'duplicate') {
              yield* abort(session);
              const replay =
                options?.claim?.kind === 'command'
                  ? yield* readCommandReplay(db, options.claim.commandId)
                  : Option.none();
              return { _tag: 'duplicate', replay } as UnitOutcome<
                A,
                Exclude<E, StoreFault>
              >;
            }

            yield* commit(session);
            return {
              _tag: 'committed',
              value: decided.success.value,
            } as UnitOutcome<A, Exclude<E, StoreFault>>;
          }),
        session => driver(() => session.endSession()).pipe(Effect.ignore),
      );

    return {
      run: (body, options) =>
        Effect.gen(function* () {
          yield* ensureIndexes(db);
          const outcome = yield* attempt(body, options).pipe(
            // The whole unit runs again, body included: that is why the body
            // must be retry-safe.
            Effect.retry({
              times: ATTEMPTS - 1,
              while: isTransient,
              schedule: BACK_OFF,
            }),
          );
          if (outcome._tag === 'committed' && options?.afterCommit) {
            yield* options.afterCommit.pipe(Effect.ignore);
          }
          return outcome;
        }),
      replay: commandId => readCommandReplay(db, commandId),
    };
  };

  return { forDatabase };
};

/** A {@link UnitOfWork} over one database. */
export const makeMongoUnitOfWork = (options: {
  readonly client: MongoSessionSource;
  readonly db: Db;
}): UnitOfWork<MongoUnit> =>
  makeMongoUnitsOfWork(options.client).forDatabase(options.db);

/** The unit of work over the service's own database. */
export class MongoUnitOfWorkTag extends Context.Service<
  MongoUnitOfWorkTag,
  UnitOfWork<MongoUnit>
>()('MongoUnitOfWorkTag') {}

/**
 * Provides {@link MongoUnitOfWorkTag} from the client and the named database
 * {@link MongoDatabaseLayer} opened.
 */
export const MongoUnitOfWorkLayer = Layer.effect(
  MongoUnitOfWorkTag,
  Effect.gen(function* () {
    const client = yield* MongoClientTag;
    const db = yield* MongoDatabaseTag;
    return makeMongoUnitOfWork({ client, db });
  }),
);
