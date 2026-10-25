import { EntifixConnError } from '@entifix/core';
import { Effect } from 'effect';
import type { MongoClient } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { makeMongoTenantDirectory } from './mongo-tenant-directory.js';

const clientListing = (names: readonly string[] | Error) =>
  ({
    db: (name: string) => ({
      databaseName: name,
      admin: () => ({
        listDatabases: () =>
          names instanceof Error
            ? Promise.reject(names)
            : Promise.resolve({ databases: names.map(n => ({ name: n })) }),
      }),
    }),
  }) as unknown as MongoClient;

describe('makeMongoTenantDirectory', () => {
  it('lists every organization whose database carries the prefix, in name order', async () => {
    const directory = makeMongoTenantDirectory(
      clientListing(['tenant_b', 'admin', 'stock_a', 'tenant_a', 'tenant_']),
      'tenant_',
    );

    const tenants = await Effect.runPromise(directory.list());

    expect(tenants.map(t => [t.organizationId, t.handle.databaseName])).toEqual(
      [
        ['a', 'tenant_a'],
        ['b', 'tenant_b'],
      ],
    );
  });

  it('reports a listing it could not make as a store failure', async () => {
    const directory = makeMongoTenantDirectory(
      clientListing(new Error('not authorized on admin')),
      'tenant_',
    );

    const error = await Effect.runPromise(directory.list().pipe(Effect.flip));

    expect(error).toBeInstanceOf(EntifixConnError);
    expect(error.details).toEqual({ prefix: 'tenant_' });
  });
});
