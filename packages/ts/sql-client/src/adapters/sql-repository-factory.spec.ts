import { EntityRepositoryFactoryTag } from '@entifix/business';
import { accessor, type Entity, entity, type EntityId } from '@entifix/core';
import { makeFakeSqlClient } from '@entifix/testing-unit/drivers';
import { Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql';
import { describe, expect, it } from 'vitest';

import { SqlRepositoryFactoryLayer } from './sql-repository-factory.js';

@entity({ key: 'gizmo' })
class Gizmo implements Entity {
  #id?: EntityId;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

describe('SqlRepositoryFactoryLayer', () => {
  it('opens a repository for an entity over the provided client', async () => {
    const fake = makeFakeSqlClient();
    fake.respondTo('gizmo', [{ id: 'g1' }]);

    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const factory = yield* EntityRepositoryFactoryTag;
        const repository = yield* factory.for(Gizmo, {});
        return yield* repository.get<Gizmo>('g1');
      }).pipe(
        Effect.provide(
          SqlRepositoryFactoryLayer.pipe(
            Layer.provide(
              Layer.succeed(
                SqlClient.SqlClient,
                fake.client as unknown as SqlClient.SqlClient,
              ),
            ),
          ),
        ),
      ),
    );

    expect(found.id).toBe('g1');
    expect(fake.lastExecution?.sql).toContain('gizmo');
  });
});
