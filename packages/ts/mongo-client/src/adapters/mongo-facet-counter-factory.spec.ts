import {
  EntityFacetCounterFactoryTag,
  TenantDatabaseResolverTag,
} from '@entifix/business';
import { ContractWidget } from '@entifix/testing-unit/contracts';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { MongoDatabaseTag } from '../mongo-database/mongo-database.js';
import {
  MongoFacetCounterFactoryLayer,
  MongoTenantFacetCounterFactoryLayer,
} from './mongo-facet-counter-factory.js';

const seeded = () =>
  makeFakeMongoDb({
    'contract-widget': [{ id: 'w-1', name: 'one', size: 1, tags: [] }],
  });

const namesOf = (
  layer: Layer.Layer<EntityFacetCounterFactoryTag>,
  organizationId?: string,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const factory = yield* EntityFacetCounterFactoryTag;
      const counter = yield* factory.for(
        ContractWidget,
        organizationId === undefined ? {} : { organizationId },
      );
      return (yield* counter.count<ContractWidget>([{ member: 'name' }]))[
        'name'
      ];
    }).pipe(Effect.provide(layer)),
  );

describe('MongoFacetCounterFactoryLayer', () => {
  it('opens every counter over the service’s one database', async () => {
    const layer = MongoFacetCounterFactoryLayer.pipe(
      Layer.provide(Layer.succeed(MongoDatabaseTag, seeded().db as Db)),
    );

    expect(await namesOf(layer)).toEqual([{ value: 'one', count: 1 }]);
  });
});

describe('MongoTenantFacetCounterFactoryLayer', () => {
  const tenantLayer = (resolved: string[]) =>
    MongoTenantFacetCounterFactoryLayer.pipe(
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

  it('opens the counter over the requesting organization’s database', async () => {
    const resolved: string[] = [];

    expect(await namesOf(tenantLayer(resolved), 'org-1')).toEqual([
      { value: 'one', count: 1 },
    ]);
    expect(resolved).toEqual(['org-1']);
  });

  it('refuses a request that names no organization', async () => {
    const resolved: string[] = [];

    await expect(namesOf(tenantLayer(resolved))).rejects.toMatchObject({
      _tag: 'Internal',
    });
    expect(resolved).toEqual([]);
  });
});
