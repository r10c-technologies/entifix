import {
  type EntifixError,
  type Entity,
  type EntityLinkResolver,
} from '@entifix/core';
import { Effect } from 'effect';

import { EntityLinkResolverTag } from '../../repository/entity-link-resolver.repository.js';

/** The members of an entity that link to other records. */
export type LinkMember<TEntity> = {
  [TKey in keyof TEntity & string]: TEntity[TKey] extends {
    readonly entityConstructor: unknown;
    readonly isLoaded: boolean;
  }
    ? TKey
    : never;
}[keyof TEntity & string];

type ResolvableLink = {
  resolve(resolver: EntityLinkResolver): Effect.Effect<unknown, EntifixError>;
};

/**
 * Resolves `members` of every record, in place, through the
 * `EntityLinkResolverTag` in context, and hands the records back.
 *
 * A record read with its linked records (a post with its tags) then reads
 * each through `targetOf`/`targetsOf`, with no `id → record` map built by
 * hand. Every link resolves concurrently; one that fails fails the whole.
 */
export function resolveLinksUCFactory<TEntity extends Entity>(
  records: readonly TEntity[],
  members: readonly LinkMember<TEntity>[],
) {
  return Effect.gen(function* () {
    const resolver = yield* EntityLinkResolverTag;
    yield* Effect.forEach(
      records.flatMap(record =>
        members.map(member =>
          (record[member] as ResolvableLink).resolve(resolver),
        ),
      ),
      resolved => resolved,
      { concurrency: 'unbounded', discard: true },
    );
    return [...records];
  });
}
