import { describeUnitOfWorkContract } from '@entifix/testing-unit/contracts';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import { Effect, Exit, Layer } from 'effect';
import type { ClientSession, Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { translateMongoFault } from '../errors/translate-mongo-error.js';
import {
  MongoClientTag,
  MongoDatabaseTag,
} from '../mongo-database/mongo-database.js';
import { OUTBOX_COLLECTION } from '../outbox/store.js';
import {
  makeMongoUnitOfWork,
  makeMongoUnitsOfWork,
  type MongoSessionSource,
  type MongoUnit,
  MongoUnitOfWorkLayer,
  MongoUnitOfWorkTag,
} from './mongo-unit-of-work.js';

type Fake = ReturnType<typeof makeFakeMongoDb>;

const WIDGETS = 'widget';

const clientOf = (fake: Fake) => fake as unknown as MongoSessionSource;
const dbOf = (fake: Fake) => fake.db as Db;

const write = (unit: MongoUnit, id: string) =>
  Effect.tryPromise({
    try: () =>
      unit.db.collection(WIDGETS).insertOne({ id }, { session: unit.session }),
    catch: translateMongoFault,
  }).pipe(Effect.asVoid);

const unitOver = (fake: Fake) =>
  makeMongoUnitOfWork({ client: clientOf(fake), db: dbOf(fake) });

/** A driver error carrying a server label, the way the real driver reports one. */
const labelled = (label: string) =>
  Object.assign(new Error(`${label} from the server`), {
    errorLabels: [label],
  });

describeUnitOfWorkContract('mongo adapter over a fake driver', () => {
  const fake = makeFakeMongoDb();
  return {
    unitOfWork: unitOver(fake),
    write,
    readIn: (unit, id) =>
      Effect.tryPromise({
        try: () =>
          unit.db
            .collection(WIDGETS)
            .findOne({ id }, { session: unit.session }),
        catch: translateMongoFault,
      }).pipe(Effect.map(found => found !== null)),
    stored: id =>
      Promise.resolve(fake.read(WIDGETS).some(doc => doc['id'] === id)),
    recorded: () =>
      Promise.resolve(
        fake.read(OUTBOX_COLLECTION).map(doc => String(doc['eventId'])),
      ),
  };
});

/**
 * A client whose sessions behave like the fake's, except for the methods
 * `override` replaces — the way a start, abort or end failure is reached.
 */
const clientWith =
  (fake: Fake, override: Partial<Record<keyof ClientSession, unknown>>) =>
  (): MongoSessionSource => ({
    startSession: () =>
      ({
        ...fake.startSession(),
        ...override,
      }) as unknown as ClientSession,
  });

describe('makeMongoUnitOfWork', () => {
  it('runs the whole unit again after a transient conflict', async () => {
    const fake = makeFakeMongoDb();
    let runs = 0;
    fake.failOnce('insertOne', labelled('TransientTransactionError'));

    const outcome = await Effect.runPromise(
      unitOver(fake).run(unit =>
        Effect.suspend(() => {
          runs += 1;
          return write(unit.handle, 'w-1');
        }),
      ),
    );

    expect(outcome._tag).toBe('committed');
    expect(runs).toBe(2);
    expect(fake.read(WIDGETS)).toHaveLength(1);
  });

  it('retries a conflict the body surfaced without wrapping it', async () => {
    const fake = makeFakeMongoDb();
    let runs = 0;

    const outcome = await Effect.runPromise(
      unitOver(fake).run(() =>
        Effect.suspend(() => {
          runs += 1;
          return runs === 1
            ? Effect.fail(
                new Error('wrapped by the body', {
                  cause: labelled('TransientTransactionError'),
                }),
              )
            : Effect.succeed('second time');
        }),
      ),
    );

    expect(outcome).toEqual({ _tag: 'committed', value: 'second time' });
  });

  it('gives up on a conflict that does not clear', async () => {
    const fake = makeFakeMongoDb();
    fake.failOn('insertOne', {
      hasErrorLabel: (label: string) => label === 'TransientTransactionError',
    });

    const exit = await Effect.runPromiseExit(
      unitOver(fake).run(unit => write(unit.handle, 'w-2')),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(fake.read(WIDGETS)).toEqual([]);
  });

  it('retries a commit whose result the server could not report', async () => {
    const fake = makeFakeMongoDb();
    fake.failOnce(
      'commitTransaction',
      labelled('UnknownTransactionCommitResult'),
    );

    const outcome = await Effect.runPromise(
      unitOver(fake).run(unit => write(unit.handle, 'w-3')),
    );

    expect(outcome._tag).toBe('committed');
    expect(fake.read(WIDGETS)).toHaveLength(1);
  });

  it('reports a transaction that would not start as a store failure', async () => {
    const fake = makeFakeMongoDb();
    const client = clientWith(fake, {
      startTransaction: () => {
        throw new Error('no replica set');
      },
    })();

    const error = await Effect.runPromise(
      makeMongoUnitOfWork({ client, db: dbOf(fake) })
        .run(() => Effect.void)
        .pipe(Effect.flip),
    );

    expect(error).toMatchObject({ _tag: 'Unavailable' });
  });

  it('keeps the outcome when ending the session or rolling back fails', async () => {
    const fake = makeFakeMongoDb();
    const client = clientWith(fake, {
      abortTransaction: () => Promise.reject(new Error('abort lost')),
      endSession: () => Promise.reject(new Error('end lost')),
    })();

    const outcome = await Effect.runPromise(
      makeMongoUnitOfWork({ client, db: dbOf(fake) }).run(() =>
        Effect.fail('refused' as const),
      ),
    );

    expect(outcome).toEqual({ _tag: 'aborted', reason: 'refused' });
  });

  it('ensures each database’s indexes once, and again after a failed ensure', async () => {
    const fake = makeFakeMongoDb();
    const units = makeMongoUnitsOfWork(clientOf(fake));
    fake.failOnce('createIndex', new Error('index build interrupted'));
    const indexCalls = () =>
      fake.operations.filter(operation => operation.op === 'createIndex')
        .length;

    const first = await Effect.runPromiseExit(
      units.forDatabase(dbOf(fake)).run(() => Effect.void),
    );
    // Let the remembered failure clear before the next unit looks for it.
    await Promise.resolve();
    const afterFailure = indexCalls();
    await Effect.runPromise(
      units.forDatabase(dbOf(fake)).run(() => Effect.void),
    );
    const afterRetry = indexCalls();
    await Effect.runPromise(
      units.forDatabase(dbOf(fake)).run(() => Effect.void),
    );

    expect(Exit.isFailure(first)).toBe(true);
    expect(afterRetry).toBeGreaterThan(afterFailure);
    expect(indexCalls()).toBe(afterRetry);
  });
});

describe('makeMongoUnitOfWork events', () => {
  it('reports an outbox it could not write as a store failure, and writes nothing', async () => {
    const fake = makeFakeMongoDb();
    fake.failOn('insertMany', new Error('disk full'));

    const error = await Effect.runPromise(
      unitOver(fake)
        .run(unit =>
          write(unit.handle, 'w-5').pipe(
            Effect.tap(() =>
              Effect.sync(() =>
                unit.emit({
                  name: 'widget.changed',
                  id: 'e-5',
                  source: 'spec',
                  at: '2026-01-01T00:00:00.000Z',
                  correlationId: 'e-5',
                  aggregate: { type: 'widget', id: 'w-5' },
                  version: 1,
                  data: {},
                }),
              ),
            ),
          ),
        )
        .pipe(Effect.flip),
    );

    expect(error).toMatchObject({ category: 'unavailable' });
    expect(fake.read(WIDGETS)).toEqual([]);
  });
});

describe('MongoUnitOfWorkLayer', () => {
  it('provides a unit of work over the service’s own database', async () => {
    const fake = makeFakeMongoDb();
    const layer = MongoUnitOfWorkLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(MongoClientTag, fake as never),
          Layer.succeed(MongoDatabaseTag, dbOf(fake)),
        ),
      ),
    );

    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const unitOfWork = yield* MongoUnitOfWorkTag;
        return yield* unitOfWork.run(unit => write(unit.handle, 'w-4'));
      }).pipe(Effect.provide(layer)),
    );

    expect(outcome._tag).toBe('committed');
    expect(fake.read(WIDGETS)).toHaveLength(1);
  });
});
