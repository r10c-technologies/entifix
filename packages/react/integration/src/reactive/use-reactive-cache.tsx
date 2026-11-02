'use client';

import {
  type DomainEvent,
  EntityChangeEventSchema,
  type EntityId,
} from '@entifix/core';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { Schema } from 'effect';
import { useEffect, useRef } from 'react';

import { entityQueryScopeFor } from '../query/entity-query-key.js';
import type { PushChannel, PushTopic } from './push-channel.js';

/**
 * What one pushed event means for the cache.
 *
 * - A **snapshot** is the record as it now is, at a version: it replaces the
 *   cached record unless the cache already holds that version or a newer one.
 * - A **hint** says something changed: the affected queries are read again.
 */
export type ReactiveCacheUpdate =
  | {
      readonly kind: 'snapshot';
      readonly entity: string;
      readonly id: EntityId;
      readonly version: number;
      readonly record: unknown;
    }
  | { readonly kind: 'hint'; readonly entity: string };

/** A record held in the cache by a snapshot, with the version it is at. */
export interface VersionedRecord<T = unknown> {
  readonly version: number;
  readonly record: T;
}

/**
 * The cache key of one record pushed as a snapshot. It sits under the entity's
 * invalidation scope, so a hint for the entity reaches it too.
 */
export const entityRecordQueryKey = (entity: string, id: EntityId) =>
  [...entityQueryScopeFor(entity), 'record', String(id)] as const;

const isEntityChange = Schema.is(EntityChangeEventSchema);

const isRecord = (data: unknown): data is Record<string, unknown> =>
  typeof data === 'object' && data !== null && !Array.isArray(data);

/**
 * The default reading of a pushed event: an entity change is a hint, and an
 * event naming an aggregate and a version whose `data` is a record is a
 * snapshot of that aggregate. Anything else means nothing to the cache.
 */
export function readReactiveUpdate(
  event: DomainEvent,
): ReactiveCacheUpdate | undefined {
  if (isEntityChange(event.data))
    return { kind: 'hint', entity: event.data.entity };
  if (
    event.aggregate !== undefined &&
    event.version !== undefined &&
    isRecord(event.data)
  )
    return {
      kind: 'snapshot',
      entity: event.aggregate.type,
      id: event.aggregate.id,
      version: event.version,
      record: event.data,
    };
  return undefined;
}

const apply = (queryClient: QueryClient, update: ReactiveCacheUpdate): void => {
  const scope = entityQueryScopeFor(update.entity);
  if (update.kind === 'hint') {
    void queryClient.invalidateQueries({ queryKey: scope });
    return;
  }
  const key = entityRecordQueryKey(update.entity, update.id);
  const cached = queryClient.getQueryData<VersionedRecord>(key);
  // A late frame for a version the cache already moved past changes nothing.
  if (cached !== undefined && cached.version >= update.version) return;
  queryClient.setQueryData<VersionedRecord>(key, {
    version: update.version,
    record: update.record,
  });
  // The lists that may show the record are read again; the record itself is
  // what was just written.
  void queryClient.invalidateQueries({
    queryKey: scope,
    predicate: query => query.queryKey[2] !== 'record',
  });
};

// The entity a topic belongs to; a flow topic belongs to none.
const entityOf = (topic: PushTopic): string | undefined => {
  const [kind, key] = topic.split(':');
  return kind === 'flow' ? undefined : key;
};

export interface UseReactiveCacheOptions {
  /** Reads what an event means for the cache. Defaults to {@link readReactiveUpdate}. */
  readonly read?: (event: DomainEvent) => ReactiveCacheUpdate | undefined;
}

/**
 * Keeps the query cache in step with what the server pushes on `topics`.
 *
 * A snapshot is written into the cache, guarded by its version, and a hint
 * invalidates the entity's queries. A `resync` for one of `topics` invalidates
 * that entity's queries, since what changed while the stream was down cannot
 * be replayed. Flow topics are left to the settlement of pending writes.
 */
export function useReactiveCache(
  channel: PushChannel,
  topics: readonly PushTopic[],
  { read = readReactiveUpdate }: UseReactiveCacheOptions = {},
): void {
  const queryClient = useQueryClient();
  // Keyed on the topics' value: a caller building the array inline would
  // otherwise resubscribe on every render.
  const key = [...topics].sort().join(' ');
  // Held in a ref for the same reason: an inline `read` is a new function on
  // every render.
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  });

  useEffect(() => {
    const own = key === '' ? [] : (key.split(' ') as PushTopic[]);
    const onEvent = (event: DomainEvent) => {
      const update = readRef.current(event);
      if (update !== undefined) apply(queryClient, update);
    };
    const unsubscribes = own.map(topic => channel.subscribe(topic, onEvent));
    unsubscribes.push(
      channel.onResync(resynced => {
        const entities = new Set(
          resynced.filter(topic => own.includes(topic)).map(entityOf),
        );
        for (const entity of entities)
          if (entity !== undefined)
            void queryClient.invalidateQueries({
              queryKey: entityQueryScopeFor(entity),
            });
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [channel, key, queryClient]);
}
