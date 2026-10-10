import { Entity, EntityLoadRequest } from '@entifix/core';
import { Effect } from 'effect';

import { EntityRepositoryTag } from '../../repository/entity.repository.js';
import { EntityLoadRequestTag } from '../../repository/entity-mixins.repository.js';

/** A request for every record it keeps: paging is the use case's to set. */
export type UnpagedRequest<TEntity extends Entity> = Omit<
  EntityLoadRequest<TEntity>,
  'page' | 'pageSize'
>;

/** How many records `loadAllUCFactory` asks the repository for at a time. */
export const LOAD_ALL_PAGE_SIZE = 100;

/**
 * Every record the request in `EntityLoadRequestTag` keeps, filtered and
 * sorted as it asks, read page by page until the repository's `total` is
 * reached.
 *
 * The request's own `page` and `pageSize` are ignored: asking for one page
 * as large as can be counted works against an in-memory source, but a real
 * adapter would hand that size to its database.
 */
export function loadAllUCFactory<TEntity extends Entity>(
  pageSize: number = LOAD_ALL_PAGE_SIZE,
) {
  return Effect.gen(function* () {
    const entityRepository = yield* EntityRepositoryTag;
    const entityLoadRequest = yield* EntityLoadRequestTag;

    // EntityLoadRequestTag carries no generic type, as in `loadUCFactory`.
    const request = entityLoadRequest as unknown as EntityLoadRequest<TEntity>;

    const items: TEntity[] = [];
    for (let page = 1; ; page += 1) {
      const result = yield* entityRepository.load<TEntity>({
        ...request,
        page,
        pageSize,
      });
      items.push(...result.items);
      // An empty page ends the read too, should `total` overstate it.
      if (result.items.length === 0 || items.length >= result.total) {
        return items;
      }
    }
  });
}
