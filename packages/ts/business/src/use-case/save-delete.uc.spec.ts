import type { Entity, EntityId } from '@entifix/core';
import { Context, Effect } from 'effect';

import type { EntityRepository } from '../repository/entity.repository.js';
import { EntityRepositoryTag } from '../repository/entity.repository.js';
import {
  EntityIdTag,
  EntityTag,
} from '../repository/entity-mixins.repository.js';
import { deleteUCFactory } from './delete/index.js';
import { saveUCFactory } from './save/index.js';

interface Widget extends Entity {
  name: string;
}

/**
 * A hand-rolled repository double. The use-cases only ever touch the tag, so a
 * partial implementation is enough — and it keeps this spec free of decorators,
 * which this package's `.spec.swcrc` compiles in legacy mode.
 */
function makeRepositoryDouble(saveResult?: Widget) {
  const calls = {
    saved: [] as Entity[],
    deleted: [] as (EntityId | Entity)[],
    options: [] as unknown[],
  };
  const repository = {
    save: (entity: Entity, options?: unknown) => {
      calls.saved.push(entity);
      calls.options.push(options);
      return Effect.succeed(saveResult ?? entity);
    },
    delete: (entityOrId: EntityId | Entity, options?: unknown) => {
      calls.deleted.push(entityOrId);
      calls.options.push(options);
      return Effect.void;
    },
  } as unknown as EntityRepository;

  return { repository, calls };
}

const testContext = (repository: EntityRepository) =>
  Context.make(EntityRepositoryTag, repository);

describe('saveUCFactory', () => {
  it('passes the entity from EntityTag to the repository', () => {
    const widget: Widget = { id: 'widget-1', name: 'Sprocket' };
    const { repository, calls } = makeRepositoryDouble();

    Effect.runSync(
      saveUCFactory<Widget>().pipe(
        Effect.provide(
          testContext(repository).pipe(Context.add(EntityTag, widget)),
        ),
      ),
    );

    expect(calls.saved).toEqual([widget]);
  });

  it('returns the repository result, not the input — a create learns its id', () => {
    const input: Widget = { id: undefined, name: 'Sprocket' };
    const stored: Widget = { id: 'generated-1', name: 'Sprocket' };
    const { repository } = makeRepositoryDouble(stored);

    const result = Effect.runSync(
      saveUCFactory<Widget>().pipe(
        Effect.provide(
          testContext(repository).pipe(Context.add(EntityTag, input)),
        ),
      ),
    );

    expect(result).toBe(stored);
    expect(result.id).toBe('generated-1');
  });
});

describe('deleteUCFactory', () => {
  it('passes the id from EntityIdTag to the repository', () => {
    const { repository, calls } = makeRepositoryDouble();

    Effect.runSync(
      deleteUCFactory<Widget>().pipe(
        Effect.provide(
          testContext(repository).pipe(Context.add(EntityIdTag, 'widget-1')),
        ),
      ),
    );

    expect(calls.deleted).toEqual(['widget-1']);
  });
});

describe('the write options', () => {
  it('reach the repository on a save and a delete', () => {
    const { repository, calls } = makeRepositoryDouble();
    const options = { expect: { member: 'state', in: ['draft'] } };

    Effect.runSync(
      saveUCFactory<Widget>(options).pipe(
        Effect.provide(
          testContext(repository).pipe(
            Context.add(EntityTag, { id: 'w-1', name: 'A' } as Widget),
          ),
        ),
      ),
    );
    Effect.runSync(
      deleteUCFactory<Widget>(options).pipe(
        Effect.provide(
          testContext(repository).pipe(Context.add(EntityIdTag, 'w-1')),
        ),
      ),
    );

    expect(calls.options).toEqual([options, options]);
  });
});
