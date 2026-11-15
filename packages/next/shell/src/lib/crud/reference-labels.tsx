'use client';

import {
  createReferenceLabels,
  type ReferenceLabel,
  type ReferenceLabelRegistration,
  ReferenceLabelsTag,
} from '@entifix/business';
import { extractMetaEntity } from '@entifix/core';
import {
  type ReferenceLabelLookup,
  ReferenceLabelsProvider,
  type ReferenceLabelState,
} from '@entifix/react-controls';
import { entityQueryScope } from '@entifix/react-integration';
import {
  type QueryClient,
  useQueries,
  useQueryClient,
} from '@tanstack/react-query';
import { Context, Effect } from 'effect';
import { type ReactNode, useMemo, useRef, useState } from 'react';

/** One read: the ids of one target entity a commit asked for and nothing had cached. */
interface Batch {
  readonly entityKey: string;
  readonly ids: readonly string[];
}

/**
 * What the per-id cache holds for a record: its label, or `null` for an id no
 * record answered — so a miss is remembered as one, not asked for again.
 */
type CachedLabel = ReferenceLabel | null;

/**
 * Reads the names of the records a screen refers to by id, and publishes them
 * to the controls
 * ([ADR 0030](../../../../../../docs/adr/0030-a-reference-names-its-target-through-the-owners-read-port.md)).
 *
 * Mounted **once by the host**, beside its other providers, with one
 * registration per target entity — `[Constructor, repositoryContext,
 * { labelProperty? }]` — because only the host has every target's adapter in
 * reach. Keep `registrations` stable (a module constant or a `useMemo`).
 *
 * Every id a render asks for is collected and, after that commit, read in
 * **one request per target entity**. Each label is cached per id under the
 * target's own query scope, so a record's page reuses what its list read, and
 * an invalidation of the target — a save, a pushed change — refreshes it.
 *
 * A reference to an entity no registration reads shows its raw id, muted, and
 * `onUnregistered` is told its key once — the host decides whether that is a
 * development warning; this mechanism does not log.
 */
export function ReferenceLabelsHost({
  registrations,
  onUnregistered,
  children,
}: {
  registrations: ReadonlyArray<ReferenceLabelRegistration>;
  onUnregistered?: (entityKey: string) => void;
  children: ReactNode;
}) {
  const labels = useMemo(
    () => Context.get(createReferenceLabels(registrations), ReferenceLabelsTag),
    [registrations],
  );
  const queryClient = useQueryClient();
  /** Ids a render asked for that no batch holds yet, by entity key. */
  const asked = useRef(new Map<string, Set<string>>());
  const [batches, setBatches] = useState<readonly Batch[]>([]);

  const results = useQueries({
    queries: batches.map(batch => {
      const entityConstructor = labels.entities.get(batch.entityKey);
      return {
        queryKey: [
          ...entityQueryScope(entityConstructor as never),
          'reference-label-batch',
          batch.ids,
        ],
        queryFn: () =>
          Effect.runPromise(labels.resolve(batch.entityKey, batch.ids)).then(
            found => {
              for (const id of batch.ids) {
                queryClient.setQueryData<CachedLabel>(
                  labelKey(entityConstructor, id),
                  found.get(id) ?? null,
                );
              }
              return true;
            },
          ),
      };
    }),
  });

  /** The unregistered keys `onUnregistered` was already told about. */
  const reported = useRef(new Set<string>());
  /** Whether a flush of what renders asked for is already queued. */
  const scheduled = useRef(false);
  /**
   * Turns everything renders asked for into one batch per target entity. Run
   * as a microtask once the render that asked has returned — a reader re-renders
   * on its own when its rows arrive, without this host rendering at all, so
   * waiting for this host's commit would wait forever. A render only asks for an
   * id nothing has cached and no batch is reading or has failed on, so the same
   * id is never read twice.
   */
  const flush = () => {
    scheduled.current = false;
    const next = [...asked.current].map(([entityKey, ids]) => ({
      entityKey,
      ids: [...ids].sort(),
    }));
    asked.current.clear();
    setBatches(previous => [...previous, ...next]);
  };

  const failedBatches = batches.filter((_, index) => results[index]?.isError);
  const pendingBatches = batches.filter(
    (_, index) => results[index]?.isPending !== false,
  );
  const dataStamp = results
    .map(result => `${result.status}${result.dataUpdatedAt}`)
    .join(',');

  const lookup = useMemo<ReferenceLabelLookup>(
    () => ({
      label(entityKey, id) {
        const entityConstructor = labels.entities.get(entityKey);
        if (entityConstructor === undefined) {
          if (!reported.current.has(entityKey)) {
            reported.current.add(entityKey);
            onUnregistered?.(entityKey);
          }
          return { status: 'unregistered' };
        }
        const cached = readLabel(queryClient, entityConstructor, id);
        if (cached !== undefined) return cached;
        const holds = (batch: Batch) =>
          batch.entityKey === entityKey && batch.ids.includes(id);
        if (failedBatches.some(holds)) return { status: 'failed' };
        if (pendingBatches.some(holds)) return { status: 'resolving' };
        let ids = asked.current.get(entityKey);
        if (ids === undefined) {
          ids = new Set();
          asked.current.set(entityKey, ids);
        }
        ids.add(id);
        if (!scheduled.current) {
          scheduled.current = true;
          queueMicrotask(flush);
        }
        return { status: 'resolving' };
      },
      noun(entityKey) {
        const entityConstructor = labels.entities.get(entityKey);
        return entityConstructor === undefined
          ? undefined
          : extractMetaEntity(entityConstructor);
      },
    }),
    // A new lookup whenever a batch starts, lands or fails — what the stamp
    // tracks — so every reader re-renders.
    [labels, queryClient, dataStamp, batches, onUnregistered],
  );

  return (
    <ReferenceLabelsProvider lookup={lookup}>
      {children}
    </ReferenceLabelsProvider>
  );
}

function labelKey(entityConstructor: unknown, id: string) {
  return [
    ...entityQueryScope(entityConstructor as never),
    'reference-label',
    id,
  ];
}

/** A cached label's state, or `undefined` when nothing is cached for the id yet. */
function readLabel(
  queryClient: QueryClient,
  entityConstructor: unknown,
  id: string,
): ReferenceLabelState | undefined {
  const state = queryClient.getQueryState<CachedLabel>(
    labelKey(entityConstructor, id),
  );
  if (state?.status !== 'success') return undefined;
  return state.data === null || state.data === undefined
    ? { status: 'notFound' }
    : { status: 'named', label: state.data };
}
