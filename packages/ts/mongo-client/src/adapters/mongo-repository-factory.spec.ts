import {
  EntityRepositoryFactoryTag,
  TenantDatabaseResolverTag,
} from '@entifix/business';
import { ContractWidget } from '@entifix/testing-unit/contracts';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { MongoDatabaseTag } from '../mongo-database/mongo-database.js';
import {
  MongoRepositoryFactoryLayer,
  MongoTenantRepositoryFactoryLayer,
} from './mongo-repository-factory.js';

const seeded = () =>
  makeFakeMongoDb({
    'contract-widget': [{ id: 'w-1', name: 'one', size: 1, tags: [] }],
  });

const totalOf = (
  layer: Layer.Layer<EntityRepositoryFactoryTag>,
  organizationId?: string,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const factory = yield* EntityRepositoryFactoryTag;
      const repository = yield* factory.for(
        ContractWidget,
        organizationId === undefined ? {} : { organizationId },
      );
      return (yield* repository.load({})).total;
    }).pipe(Effect.provide(layer)),
  );

describe('MongoRepositoryFactoryLayer', () => {
  it('opens every repository over the service’s one database', async () => {
    const layer = MongoRepositoryFactoryLayer.pipe(
      Layer.provide(Layer.succeed(MongoDatabaseTag, seeded().db as Db)),
    );

    expect(await totalOf(layer)).toBe(1);
  });
});

describe('MongoTenantRepositoryFactoryLayer', () => {
  const tenantLayer = (resolved: string[]) =>
    MongoTenantRepositoryFactoryLayer.pipe(
      Layer.provide(
        Layer.succeed(TenantDatabaseResolverTag, {
          forOrganization: (organizationId: string) =>
            Effect.sync(() => {
              resolved.push(organizationId);
              return seeded().db;
            }),
        }),
      ),
    );

  it('opens the repository over the requesting organization’s database', async () => {
    const resolved: string[] = [];

    expect(await totalOf(tenantLayer(resolved), 'org-1')).toBe(1);
    expect(resolved).toEqual(['org-1']);
  });

  it('refuses a request that names no organization', async () => {
    const resolved: string[] = [];

    await expect(totalOf(tenantLayer(resolved))).rejects.toMatchObject({
      _tag: 'Internal',
    });
    expect(resolved).toEqual([]);
  });
});
