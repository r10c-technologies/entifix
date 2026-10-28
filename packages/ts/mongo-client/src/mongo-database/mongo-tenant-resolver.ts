import type { TenantDatabaseResolver } from '@entifix/business';
import { Invalid } from '@entifix/core';
import { Effect } from 'effect';
import type { Db, MongoClient } from 'mongodb';

/** Mongo's own limit on a database name, minus room for a prefix. */
const MAX_DB_NAME_LENGTH = 63;

/**
 * Mongo names a database with a small character set. An organization id is a
 * hex ObjectId today, but this guards the shape rather than trusting it: a name
 * assembled from an unvalidated id is a place where a crafted value could reach
 * another tenant's database.
 */
const SAFE_ORGANIZATION_ID = /^[a-zA-Z0-9_-]+$/;

/**
 * Resolves one organization's Mongo database from a single connected client.
 *
 * Cheap by construction: `client.db(name)` returns a **handle**, not a
 * connection, so N organizations share one pool and one socket set, and Mongo
 * creates the database lazily on first write — which is why provisioning an
 * organization is a control-plane record plus this naming convention, with no
 * `CREATE DATABASE` step to fail halfway.
 *
 * Call it inside the request. The pool is the boot-time `MongoDatabaseLayer`;
 * wrapping this in a per-request `Layer` would rebuild the pool per request.
 */
export const makeMongoTenantResolver = (
  client: MongoClient,
  prefix: string,
): TenantDatabaseResolver<Db> => ({
  forOrganization: (organizationId: string) =>
    Effect.gen(function* () {
      if (!SAFE_ORGANIZATION_ID.test(organizationId)) {
        return yield* Effect.fail(
          new Invalid({
            errors: [
              {
                pointer: '/organizationId',
                // The id itself is deliberately not echoed: it arrived unvalidated.
                detail: 'not a safe organization id',
                code: 'unsafeOrganizationId',
              },
            ],
          }),
        );
      }

      const name = `${prefix}${organizationId}`;
      if (name.length > MAX_DB_NAME_LENGTH) {
        return yield* Effect.fail(
          new Invalid({
            errors: [
              {
                pointer: '/organizationId',
                detail: `the tenant database name exceeds ${MAX_DB_NAME_LENGTH} characters`,
                code: 'organizationIdTooLong',
              },
            ],
          }),
        );
      }

      return client.db(name);
    }),
});
