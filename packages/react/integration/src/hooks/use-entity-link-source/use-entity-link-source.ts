'use client';

import { EntityIdTag, EntityLoadRequestTag } from '@entifix/business';
import {
  defaultLocale,
  describeEntityColumns,
  type EntifixFailure,
  type Entity,
  type EntityFieldDescriptor,
  type EntityLinkSource,
  type EntityLoadRequest,
  type EntityPage,
  localizedQueryProperty,
} from '@entifix/core';
import { useQuery } from '@tanstack/react-query';
import { Context, Effect } from 'effect';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { combineFilterGroups } from '../../query/combine-filtering.js';
import {
  entityQueryKey,
  entityQueryScope,
} from '../../query/entity-query-key.js';
import { useDataLoading } from '../use-data-loading/index.js';
import type {
  EntityLinkSourceConfig,
  UseEntityLinkSourceOptions,
} from './use-entity-link-source.types.js';

const DEFAULT_QUICK_PAGE_SIZE = 10;
const DEFAULT_DEBOUNCE_MS = 250;

/**
 * Fails loudly on a search property the service will reject, and returns its
 * descriptor.
 *
 * A member's `filterable` metadata is also the server-side filter allowlist, so a
 * quick search over a member that lacks it answers `400` — as an empty
 * suggestion list, which reads to the user as "there are no brands". Better to
 * break the developer's build than to lie to them. A `localized` member is
 * searchable like any other: it is queried in the reader's locale.
 */
function assertSearchable<TTarget extends Entity>(
  config: EntityLinkSourceConfig<TTarget, unknown>,
  searchProperty: string,
): EntityFieldDescriptor {
  const target = describeEntityColumns(config.entityConstructor).find(
    column => column.name === searchProperty,
  );
  if (target?.filterable === true) return target;

  throw new Error(
    `Cannot search ${config.entityConstructor.name} by "${searchProperty}": ` +
      'the member is not filterable, so the service would reject the query. ' +
      'Declare it `filterable` on the target entity, or point the relation at ' +
      'another member with `linkSearchProperty`.',
  );
}

/**
 * Produces the {@link EntityLinkSource} a link editor runs on: the quick
 * type-ahead, the browse list, and the label of whatever key is currently held.
 *
 * This is the data half of the link mechanism. It exists as a hook — rather than
 * inside the input — because `@entifix/react-controls` may not import this package
 * (both are T3, and the tier register declares no sideways edge between them), so
 * the two meet at the framework-free port declared in `@entifix/core`. A form
 * wrapper calls it once per relation and hands the results to `EntityForm`'s
 * `linkSources`.
 *
 * What may be picked is never decided here: the caller's `loadUc` (and optional
 * `baseFiltering`) is what restricts the set, so a domain rule about assignable
 * targets lives in a use-case, not in the UI.
 *
 * Three requests, each held back until it means something: the quick search runs
 * a small page and re-runs on a debounced term; the browse list does not fetch at
 * all until the dialog opens; and the label is only looked up when the caller has
 * an id but no instance — a draft restored from storage — because a picked target
 * already knows its own name.
 */
export function useEntityLinkSource<TTarget extends Entity, TContext>(
  config: EntityLinkSourceConfig<TTarget, TContext>,
  {
    descriptor,
    selectedId,
    selectedEntity,
    locale = defaultLocale(),
  }: UseEntityLinkSourceOptions<TTarget>,
): EntityLinkSource<TTarget> {
  const {
    entityConstructor,
    loadUc,
    getUc,
    ctx,
    baseFiltering,
    quickPageSize = DEFAULT_QUICK_PAGE_SIZE,
    debounceMs = DEFAULT_DEBOUNCE_MS,
  } = config;

  const searchDescriptor = assertSearchable(
    config as unknown as EntityLinkSourceConfig<TTarget, unknown>,
    descriptor.linkSearchProperty,
  );
  // A localized member is filtered and sorted one locale at a time — the
  // reader's — and its options read in that locale.
  const search = localizedQueryProperty(searchDescriptor, locale);
  const searchProperty = search.property;
  const labelDescriptor = describeEntityColumns(entityConstructor).find(
    column => column.name === descriptor.linkLabelProperty,
  );
  const isLocalizedSearch = searchDescriptor.type === 'localized';

  // Callers rebuild `loadUc`/`getUc`/`ctx` inline on every render, so the latest
  // are held in refs and kept out of the query keys — keying on their identity
  // would refetch on every render. Same reason and same shape as `useDataLoading`.
  const effects = useRef({ loadUc, getUc, ctx });
  useEffect(() => {
    effects.current = { loadUc, getUc, ctx };
  });

  const [term, setTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [isOpen, setOpen] = useState(false);

  // Typing is not a request per keystroke: the term settles first, and only the
  // settled value reaches the service.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(term), debounceMs);
    return () => clearTimeout(timer);
  }, [term, debounceMs]);

  const quickRequest = useMemo<EntityLoadRequest<TTarget>>(() => {
    const filtering = combineFilterGroups<TTarget>(
      baseFiltering,
      debouncedTerm === ''
        ? undefined
        : {
            operator: 'and',
            values: [
              {
                property: searchProperty as keyof TTarget,
                operator: 'like',
                value: debouncedTerm,
              },
            ],
          },
    );

    const request: EntityLoadRequest<TTarget> = {
      page: 1,
      pageSize: quickPageSize,
    };
    if (filtering) request.filtering = [filtering];
    // Suggestions in one locale's order, so they do not reshuffle as records
    // are rewritten — the service applies no order of its own.
    if (isLocalizedSearch) {
      request.sorting = [
        { 0: { property: searchProperty as keyof TTarget, type: 'asc' } },
      ];
    }
    return request;
  }, [
    baseFiltering,
    debouncedTerm,
    isLocalizedSearch,
    quickPageSize,
    searchProperty,
  ]);

  const quickQuery = useQuery<EntityPage<TTarget>, EntifixFailure>({
    queryKey: [
      ...entityQueryKey(entityConstructor, quickRequest),
      'link-quick',
    ],
    queryFn: () =>
      Effect.runPromise(
        Effect.provide(
          effects.current.loadUc,
          effects.current.ctx.pipe(
            Context.add(
              EntityLoadRequestTag,
              // The tag carries no generic, so the entity-typed request crosses
              // it — the same cast `loadUCFactory` makes reading it back.
              quickRequest as unknown as EntityLoadRequest,
            ),
          ),
        ),
      ),
  });

  const browse = useDataLoading<TTarget, TContext>({
    uc: loadUc,
    ctx,
    queryKey: entityQueryScope(entityConstructor),
    baseFiltering,
    enabled: isOpen,
  });

  const needsLabel =
    selectedEntity === undefined && selectedId != null && getUc !== undefined;

  const labelQuery = useQuery<TTarget, EntifixFailure>({
    queryKey: [
      ...entityQueryScope(entityConstructor),
      'link-label',
      String(selectedId),
    ],
    enabled: needsLabel,
    queryFn: () =>
      Effect.runPromise(
        Effect.provide(
          // Guarded by `enabled`: the query only runs when both are present.
          effects.current.getUc as NonNullable<typeof getUc>,
          effects.current.ctx.pipe(Context.add(EntityIdTag, selectedId)),
        ),
      ),
  });

  // A blank label is as useless as a missing one, so both fall back to the key —
  // an unnamed row must still be distinguishable from the row above it.
  const labelOf = useCallback(
    (target: TTarget) => {
      const raw = (target as Record<string, unknown>)[
        descriptor.linkLabelProperty
      ];
      // A label member the target does not declare reads as nothing, so the
      // option falls back to its id.
      const label =
        labelDescriptor &&
        localizedQueryProperty(labelDescriptor, locale).read(raw);
      return label ? label : String(target.id ?? '');
    },
    [descriptor.linkLabelProperty, labelDescriptor, locale],
  );

  const resolved = selectedEntity ?? labelQuery.data;

  return {
    entityConstructor,
    labelOf,
    selected: {
      label: resolved === undefined ? undefined : labelOf(resolved),
      // The whole target, not only its name. The lookup above already fetched
      // it, and a form restoring a draft has nothing else to rebuild an
      // `embedded` relation from — the draft kept the id and lost the instance.
      entity: resolved,
      isLoading: needsLabel && labelQuery.isFetching,
    },
    quick: {
      term,
      setTerm,
      options: quickQuery.data?.items ?? [],
      isLoading: quickQuery.isFetching,
      error: quickQuery.error ?? undefined,
    },
    browse: {
      ...browse,
      isOpen,
      open: () => setOpen(true),
      close: () => setOpen(false),
    },
  };
}
