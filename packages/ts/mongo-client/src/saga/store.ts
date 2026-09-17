import { EntifixConnError } from '@entifix/core';
import {
  type SagaInstance,
  type SagaState,
  type SagaStepOutcome,
  type SagaStore,
  SagaStoreTag,
} from '@entifix/transactions';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';

import { MongoDatabaseTag } from '../mongo-database/mongo-database.js';

/**
 * Saga instances: one document per flow, the durable record a coordinator
 * resumes from (r10c ADR 0055).
 */
export const SAGA_COLLECTION = 'saga_instances';

/** The two states a sweep treats as unfinished. */
const UNFINISHED: readonly SagaState[] = ['RUNNING', 'COMPENSATING'];

const failed = (message: string, sagaId: string) => (error: unknown) =>
  new EntifixConnError(message, error, { sagaId });

const sagaCollection = (db: Db) => db.collection<SagaInstance>(SAGA_COLLECTION);

const deadline = (olderThanMs: number) =>
  new Date(Date.now() - olderThanMs).toISOString();

/**
 * A unique index on `sagaId`, so a resumed coordinator can never create a
 * second instance for one flow, and `{ state, updatedAt }` for the sweep —
 * without it every pass is a scan of every saga ever run, on a schedule.
 */
export const ensureSagaIndexes = (db: Db) =>
  Effect.tryPromise({
    try: async () => {
      await sagaCollection(db).createIndex({ sagaId: 1 }, { unique: true });
      await sagaCollection(db).createIndex({ state: 1, updatedAt: 1 });
    },
    catch: error =>
      new EntifixConnError('Failed to ensure saga indexes', error, {
        database: db.databaseName,
      }),
  });

/** {@link SagaStore} over one Mongo database. */
export const makeMongoSagaStore = (db: Db): SagaStore => {
  const collection = sagaCollection(db);
  const stamp = () => new Date().toISOString();

  return {
    start: instance =>
      Effect.tryPromise({
        try: async () => {
          // `$setOnInsert` with an upsert rather than `insertOne`: a coordinator
          // restarted mid-flight re-enters with an id it already wrote, and
          // refusing that would turn a recoverable resume into a hard failure.
          await collection.updateOne(
            { sagaId: instance.sagaId },
            { $setOnInsert: { ...instance, updatedAt: stamp() } },
            { upsert: true },
          );
        },
        catch: failed('Failed to start the saga instance', instance.sagaId),
      }),

    beginStep: (sagaId, stepIndex) =>
      Effect.tryPromise({
        try: async () => {
          await collection.updateOne(
            { sagaId },
            { $set: { stepIndex, updatedAt: stamp() } },
          );
        },
        catch: failed('Failed to record the step transition', sagaId),
      }),

    recordOutcome: (sagaId, outcome: SagaStepOutcome) =>
      Effect.tryPromise({
        try: async () => {
          await collection.updateOne(
            { sagaId },
            // `$push`, never a read-modify-write of the array: two outcomes
            // recorded from one process would otherwise lose one another, and a
            // lost outcome is a compensation that cannot address what it undoes.
            { $push: { outcomes: outcome }, $set: { updatedAt: stamp() } },
          );
        },
        catch: failed('Failed to record the step outcome', sagaId),
      }),

    settle: (sagaId, state, error) =>
      Effect.tryPromise({
        try: async () => {
          await collection.updateOne(
            { sagaId },
            { $set: { state, error, updatedAt: stamp() } },
          );
        },
        catch: failed('Failed to settle the saga instance', sagaId),
      }),

    /**
     * Take ownership of a stale instance, or answer `undefined`.
     *
     * ⚠️ **One conditional write, not a read and then a write.** The filter
     * repeats `findStale`'s predicate, so two sweepers racing the same instance
     * produce one winner: the loser's filter no longer matches because the
     * winner re-stamped `updatedAt`. That stamp is also what stops the next tick
     * finding the instance this sweep is still working on.
     */
    claimForResume: (sagaId, olderThanMs) =>
      Effect.tryPromise({
        try: async () => {
          const claimed = await collection.findOneAndUpdate(
            {
              sagaId,
              state: { $in: [...UNFINISHED] },
              updatedAt: { $lt: deadline(olderThanMs) },
            },
            { $inc: { resumeAttempts: 1 }, $set: { updatedAt: stamp() } },
            { returnDocument: 'after', projection: { _id: 0 } },
          );
          return (claimed ?? undefined) as SagaInstance | undefined;
        },
        catch: failed('Failed to claim the saga instance', sagaId),
      }),

    /**
     * Flag one step's calls as given back, addressing the outcome by its step
     * id: outcomes are `$push`ed, so an index is a fact about arrival order and
     * a resumed walk must not depend on one.
     */
    markCompensated: (sagaId, stepId) =>
      Effect.tryPromise({
        try: async () => {
          await collection.updateOne(
            { sagaId },
            {
              $set: {
                'outcomes.$[entry].compensated': true,
                updatedAt: stamp(),
              },
            },
            { arrayFilters: [{ 'entry.stepId': stepId }] },
          );
        },
        catch: failed('Failed to mark the step compensated', sagaId),
      }),

    get: sagaId =>
      Effect.tryPromise({
        try: async () =>
          ((await collection.findOne({ sagaId }, { projection: { _id: 0 } })) ??
            undefined) as SagaInstance | undefined,
        catch: failed('Failed to read the saga instance', sagaId),
      }),

    /**
     * Instances stuck mid-flight past a deadline. ⚠️ `COMPENSATING` counts: a
     * coordinator that died while unwinding is the state that leaves holds in
     * place, and the one an operator most needs to find.
     */
    findStale: olderThanMs =>
      Effect.tryPromise({
        try: async () =>
          (await collection
            .find(
              {
                state: { $in: [...UNFINISHED] },
                updatedAt: { $lt: deadline(olderThanMs) },
              },
              { projection: { _id: 0 } },
            )
            .toArray()) as SagaInstance[],
        catch: failed('Failed to find stale saga instances', ''),
      }),
  };
};

/**
 * Provides {@link SagaStoreTag} from the service's own database, creating the
 * indexes first.
 */
export const MongoSagaStoreLayer = Layer.effect(
  SagaStoreTag,
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    yield* ensureSagaIndexes(db);
    return makeMongoSagaStore(db);
  }),
);
