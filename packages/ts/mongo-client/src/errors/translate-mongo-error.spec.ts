import { Contention, DuplicateKey, Unavailable } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import {
  mongoErrorLabelled,
  translateMongoError,
  translateMongoFault,
} from './translate-mongo-error.js';

/** A driver error as the driver raises it: a name, a code, maybe labels. */
const driverError = (fields: Record<string, unknown>) =>
  Object.assign(new Error('driver said no'), fields);

describe('translateMongoError', () => {
  it('reads a duplicate key on a declared uniqueness as a conflict, naming the key', () => {
    expect(
      translateMongoError(
        driverError({
          name: 'MongoServerError',
          code: 11000,
          keyPattern: { slug: 1 },
        }),
      ),
    ).toMatchObject({
      _tag: 'DuplicateKey',
      key: 'slug',
      category: 'conflict',
    });
    expect(translateMongoError(driverError({ code: 11000 }))).toMatchObject({
      _tag: 'DuplicateKey',
    });
    expect(
      translateMongoError(driverError({ code: 11000 })),
    ).not.toHaveProperty('key');
  });

  it('finds a duplicate inside a bulk write too', () => {
    expect(
      translateMongoError(
        driverError({
          name: 'MongoBulkWriteError',
          writeErrors: [{ code: 11000 }],
        }),
      ),
    ).toMatchObject({ _tag: 'DuplicateKey' });
  });

  it('reads a duplicate on a claim as a race lost', () => {
    expect(
      translateMongoError(driverError({ code: 11000 }), {
        duplicate: 'contention',
      }),
    ).toMatchObject({ _tag: 'Contention', category: 'contention' });
  });

  it('reads a write conflict or a transient label as contention, anywhere in the chain', () => {
    expect(translateMongoError(driverError({ code: 112 }))).toMatchObject({
      _tag: 'Contention',
    });
    expect(
      translateMongoError({
        cause: {
          hasErrorLabel: (label: string) =>
            label === 'TransientTransactionError',
        },
      }),
    ).toMatchObject({ _tag: 'Contention' });
    expect(
      translateMongoError({ errorLabels: ['TransientTransactionError'] }),
    ).toMatchObject({ _tag: 'Contention' });
  });

  it.each([
    [{ code: 50 }],
    [{ name: 'MongoNetworkTimeoutError' }],
    [{ name: 'MongoOperationTimeoutError' }],
  ])('reads %j as a timeout', fields => {
    expect(
      translateMongoError(driverError(fields), { dependency: 'catalog' }),
    ).toMatchObject({ _tag: 'Timeout', dependency: 'catalog' });
  });

  it('reads an undecodable document as a protocol failure', () => {
    expect(
      translateMongoError(driverError({ name: 'BSONError' })),
    ).toMatchObject({
      _tag: 'ProtocolFailure',
      category: 'protocol',
    });
  });

  it.each([
    'MongoNetworkError',
    'MongoServerSelectionError',
    'MongoNotConnectedError',
    'MongoTopologyClosedError',
  ])('reads %s as unavailable', name => {
    expect(translateMongoError(driverError({ name }))).toMatchObject({
      _tag: 'Unavailable',
      dependency: 'mongo',
    });
  });

  it('reads anything else, or nothing at all, as unavailable', () => {
    expect(translateMongoError(new Error('who knows'))).toMatchObject({
      _tag: 'Unavailable',
    });
    expect(translateMongoError(undefined)).toMatchObject({
      _tag: 'Unavailable',
    });
    expect(translateMongoError('a string')).toMatchObject({
      _tag: 'Unavailable',
    });
  });

  it('passes a failure already translated through unchanged', () => {
    const inner = new DuplicateKey({ key: 'slug' });

    expect(translateMongoError(inner)).toBe(inner);
  });
});

describe('translateMongoFault', () => {
  it('never answers a duplicate as anything but a race lost', () => {
    expect(translateMongoFault(driverError({ code: 11000 }))).toMatchObject({
      _tag: 'Contention',
    });
    expect(translateMongoFault(new DuplicateKey({}))).toMatchObject({
      _tag: 'Contention',
    });
  });

  it('keeps the store faults it was given', () => {
    const down = new Unavailable({});

    expect(translateMongoFault(down)).toBe(down);
    expect(translateMongoFault(new Contention())).toMatchObject({
      _tag: 'Contention',
    });
  });
});

describe('mongoErrorLabelled', () => {
  it('stops looking after five causes', () => {
    let deep: Record<string, unknown> = { errorLabels: ['X'] };
    for (let depth = 0; depth < 6; depth += 1) deep = { cause: deep };

    expect(mongoErrorLabelled(deep, 'X')).toBe(false);
    expect(mongoErrorLabelled(null, 'X')).toBe(false);
  });
});
