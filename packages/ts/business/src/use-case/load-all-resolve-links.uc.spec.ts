import type {
  Entity,
  EntityConstructor,
  EntityId,
  EntityLinkResolver,
  EntityLoadRequest,
} from '@entifix/core';
import {
  EntifixConnError,
  EntityCollectionLink,
  EntityLink,
  targetOf,
  targetsOf,
} from '@entifix/core';
import { Context, Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { EntityRepository } from '../repository/entity.repository.js';
import { EntityRepositoryTag } from '../repository/entity.repository.js';
import { EntityLinkResolverTag } from '../repository/entity-link-resolver.repository.js';
import { EntityLoadRequestTag } from '../repository/entity-mixins.repository.js';
import {
  LOAD_ALL_PAGE_SIZE,
  loadAllUCFactory,
  resolveLinksUCFactory,
} from './load/index.js';

class Tag implements Entity {
  constructor(public id: EntityId = undefined) {}
}

class Post implements Entity {
  constructor(
    public id: EntityId = undefined,
    public tags = new EntityCollectionLink(Tag),
    public pinned = new EntityLink(Tag),
  ) {}
}

/**
 * A repository double that pages over `records`, recording each request, and
 * reports `total` as given — so a test can make it overstate what it holds.
 */
function pagingRepository(records: Tag[], total = records.length) {
  const requests: EntityLoadRequest[] = [];
  const repository = {
    load: (request: EntityLoadRequest) => {
      requests.push(request);
      const page = request.page ?? 1;
      const size = request.pageSize ?? records.length;
      return Effect.succeed({
        items: records.slice((page - 1) * size, page * size),
        total,
        request,
      });
    },
  } as unknown as EntityRepository;
  return { repository, requests };
}

const loadAll = (
  repository: EntityRepository,
  request: EntityLoadRequest,
  pageSize?: number,
) =>
  Effect.runPromise(
    Effect.provide(
      loadAllUCFactory<Tag>(pageSize),
      Context.make(EntityRepositoryTag, repository).pipe(
        Context.add(EntityLoadRequestTag, request),
      ),
    ),
  );

const tags = (n: number) =>
  Array.from({ length: n }, (_, i) => new Tag(`t${i}`));

describe('loadAllUCFactory', () => {
  it('reads page after page until the total is reached', async () => {
    const { repository, requests } = pagingRepository(tags(5));

    const all = await loadAll(repository, {}, 2);

    expect(all.map(tag => tag.id)).toEqual(['t0', 't1', 't2', 't3', 't4']);
    expect(requests.map(request => request.page)).toEqual([1, 2, 3]);
  });

  it("keeps the request's filtering and sorting, and sets its own paging", async () => {
    const { repository, requests } = pagingRepository(tags(1));
    const filtering = [
      { property: 'id' as const, operator: 'eq' as const, value: 't0' },
    ];

    await loadAll(repository, { filtering, page: 7, pageSize: 1000 });

    expect(requests).toEqual([
      { filtering, page: 1, pageSize: LOAD_ALL_PAGE_SIZE },
    ]);
  });

  it('stops at an empty page when the total overstates the records', async () => {
    const { repository, requests } = pagingRepository(tags(2), 10);

    const all = await loadAll(repository, {}, 2);

    expect(all).toHaveLength(2);
    expect(requests).toHaveLength(2);
  });

  it('answers an empty list when nothing is kept', async () => {
    const { repository } = pagingRepository([]);
    expect(await loadAll(repository, {})).toEqual([]);
  });
});

describe('resolveLinksUCFactory', () => {
  const known = tags(3);
  const resolver: EntityLinkResolver = {
    resolve<TEntity extends Entity>(
      _entity: EntityConstructor<TEntity>,
      id: EntityId,
    ) {
      const found = known.find(tag => tag.id === id);
      return found === undefined
        ? Effect.fail(new EntifixConnError(`No tag ${String(id)}`))
        : (Effect.succeed(found) as unknown as Effect.Effect<
            TEntity,
            EntifixConnError
          >);
    },
  };
  const resolve = (posts: Post[], members: ('tags' | 'pinned')[]) =>
    Effect.runPromiseExit(
      Effect.provide(
        resolveLinksUCFactory(posts, members),
        Context.make(EntityLinkResolverTag, resolver),
      ),
    );

  it('resolves the members asked for, on every record', async () => {
    const posts = [
      new Post(
        'p1',
        new EntityCollectionLink(Tag, { ids: ['t2', 't0'] }),
        new EntityLink(Tag, { id: 't1' }),
      ),
      new Post('p2', new EntityCollectionLink(Tag, { ids: ['t1'] })),
    ];

    const exit = await resolve(posts, ['tags']);

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(targetsOf(posts[0].tags)).toEqual([known[2], known[0]]);
    expect(targetsOf(posts[1].tags)).toEqual([known[1]]);
    expect(posts[0].pinned.isLoaded).toBe(false);
  });

  it('hands the records back, so a read can return them', async () => {
    const post = new Post('p1', undefined, new EntityLink(Tag, { id: 't0' }));

    const exit = await resolve([post], ['pinned']);

    expect(exit).toEqual(Exit.succeed([post]));
    expect(targetOf(post.pinned)).toBe(known[0]);
  });

  it('fails when a link names a record the resolver cannot find', async () => {
    const post = new Post('p1', undefined, new EntityLink(Tag, { id: 'nope' }));

    const exit = await resolve([post], ['pinned']);

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
