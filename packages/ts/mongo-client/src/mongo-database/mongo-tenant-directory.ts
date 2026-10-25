import type { TenantDirectory } from '@entifix/business';
import { EntifixConnError } from '@entifix/core';
import { Effect } from 'effect';
import type { Db, MongoClient } from 'mongodb';

/**
 * Lists every database named `<prefix><organizationId>` on one client — the
 * same naming {@link makeMongoTenantResolver} resolves one organization by.
 *
 * `listDatabases` needs cluster-wide rights and a round trip, which is why it
 * is a directory for background work and never a request's path: a request
 * already knows its organization and resolves it directly.
 *
 * Only a database that exists is listed, and Mongo creates one lazily on its
 * first write. An organization that has never written to this store is not
 * here, which is right for every sweep: it has nothing to sweep.
 */
export const makeMongoTenantDirectory = (
  client: MongoClient,
  prefix: string,
): TenantDirectory<Db> => ({
  list: () =>
    Effect.tryPromise({
      try: async () => {
        const { databases } = await client.db('admin').admin().listDatabases({
          nameOnly: true,
        });
        return databases
          .map(database => database.name)
          .filter(
            name => name.startsWith(prefix) && name.length > prefix.length,
          )
          .sort()
          .map(name => ({
            organizationId: name.slice(prefix.length),
            handle: client.db(name),
          }));
      },
      catch: error =>
        new EntifixConnError('Failed to list tenant databases', error, {
          prefix,
        }),
    }),
});
