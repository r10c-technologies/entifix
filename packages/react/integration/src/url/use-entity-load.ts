import {
  EntityLoadRequestTag,
  type EntityRepository,
  EntityRepositoryTag,
  loadAllUCFactory,
} from '@entifix/business';
import {
  type Entity,
  type EntityLoadRequest,
  type EntityPage,
} from '@entifix/core';
import { Context, Effect } from 'effect';
import { useEffect, useState } from 'react';

import type { EntitySource } from './entity-source.js';

export type EntityLoad<TEntity extends Entity> =
  | { readonly status: 'idle' }
  /**
   * Waiting for an answer. `previous` is the last answer from the same
   * source, so a filter being changed keeps showing what it showed.
   */
  | { readonly status: 'pending'; readonly previous?: EntityPage<TEntity> }
  | { readonly status: 'done'; readonly page: EntityPage<TEntity> }
  | { readonly status: 'failed'; readonly error: unknown };

const IDLE = { status: 'idle' } as const;

/**
 * Every record a request keeps, through the `loadAll` use case: a filter
 * never pages.
 */
async function loadEvery<TEntity extends Entity>(
  repository: EntityRepository,
  request: EntityLoadRequest<TEntity>,
): Promise<EntityPage<TEntity>> {
  const context = Context.make(EntityRepositoryTag, repository).pipe(
    Context.add(EntityLoadRequestTag, request as unknown as EntityLoadRequest),
  );
  const items = await Effect.runPromise(
    Effect.provide(loadAllUCFactory<TEntity>(), context),
  );
  return { items, total: items.length, request };
}

interface Answer<TEntity extends Entity> {
  readonly source: EntitySource;
  readonly key: string;
  readonly load: EntityLoad<TEntity>;
}

/**
 * Every record a request selects, through the `loadAll` use case over a source.
 *
 * `null` asks for nothing and answers `idle`: before hydration, and while no
 * filter is set, the page shows what the build rendered. An answer counts only
 * for the request it was asked for, so a late answer to an older filter is
 * never shown as the current one.
 */
export function useEntityLoad<TEntity extends Entity>(
  source: EntitySource,
  request: EntityLoadRequest<TEntity> | null,
): EntityLoad<TEntity> {
  const [answer, setAnswer] = useState<Answer<TEntity>>();
  // Requests are rebuilt on every render; their content is what changes.
  const key = request === null ? null : JSON.stringify(request);

  useEffect(() => {
    if (request === null || key === null) return;
    const settle = (load: EntityLoad<TEntity>) =>
      setAnswer({ source, key, load });
    source()
      .then(repository => loadEvery<TEntity>(repository, request))
      .then(
        page => settle({ status: 'done', page }),
        (error: unknown) => settle({ status: 'failed', error }),
      );
    // `request` is read through `key`, its content: a new object with the
    // same content is the same request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, key]);

  if (key === null) return IDLE;
  if (answer?.source !== source) return { status: 'pending' };
  if (answer.key === key) return answer.load;
  return answer.load.status === 'done'
    ? { status: 'pending', previous: answer.load.page }
    : { status: 'pending' };
}
