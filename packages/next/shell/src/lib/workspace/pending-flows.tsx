'use client';

import { useToasts } from '@entifix/react-controls';
import {
  type FlowStatusRead,
  makePendingFlowStore,
  type PendingFlowStorage,
  PendingFlowStoreProvider,
  type PushChannel,
  usePendingFlowSettlement,
} from '@entifix/react-integration';
import { type ReactNode, useMemo } from 'react';

import { makeIndexedDbStateStorage } from './idb-state-storage.js';
import { ANONYMOUS_WORKSPACE_SCOPE } from './workspace-scope.js';

/**
 * How long a pending flow nobody can account for is kept before it is
 * dropped: no push arrived, and its status read answers nothing. Long enough
 * for a flow that waits on a person, short enough that a lost one does not
 * hold a form open across a working day.
 */
export const PENDING_FLOW_MAX_AGE_MS = 30 * 60 * 1000;

// Module scope: a storage per render would reopen the database each time.
const pendingFlowStorage = makeIndexedDbStateStorage(
  'entifix-pending-flows',
  'flows',
);

export interface PendingFlowsProviderProps {
  /**
   * Whose pending flows these are — `workspaceScopeKey({ userId,
   * organizationId })`, or `ANONYMOUS_WORKSPACE_SCOPE` for nobody in
   * particular, which keeps flow ids and their age only.
   *
   * Required for the reason `PendingTransactionsProviderProps.scope` is:
   * IndexedDB belongs to the browser profile, not to whoever signed in.
   */
  readonly scope: string;
  /** The tab's push channel, where each pending flow's outcome arrives. */
  readonly channel: PushChannel;
  /**
   * Reads a flow's status link when its push may have been missed —
   * `buildFlowStatusReader()` over REST. Omitted, a flow settles by push
   * alone, and one whose push was missed is dropped at the age bound.
   */
  readonly readStatus?: FlowStatusRead;
  readonly maxAgeMs?: number;
  /** Defaults to IndexedDB, so a pending write survives a reload. */
  readonly storage?: PendingFlowStorage;
  readonly children: ReactNode;
}

/**
 * Waits on every write this browser handed to a flow, and tells the operator
 * once when one fails
 * ([ADR 0022](../../../../../../docs/adr/0022-two-settle-modes-and-the-pending-flow-store.md)).
 *
 * It holds the pending-flow store the generated CRUD records into, persisted
 * per principal, and settles each flow from its push or from a status read
 * after a reconnect. A failed flow is shown through the host's
 * `ToastRegion`, translated, exactly once — however many tabs or
 * redeliveries report it.
 *
 * ⚠️ **Mount it inside a `ToastProvider`, and above the plain routes**, not
 * only the workspace: a create is `/<basePath>/new` on the route host.
 */
export function PendingFlowsProvider({
  scope,
  channel,
  readStatus,
  maxAgeMs = PENDING_FLOW_MAX_AGE_MS,
  storage = pendingFlowStorage,
  children,
}: PendingFlowsProviderProps) {
  const toasts = useToasts();

  // A store per principal: a sign-in under another scope must never read the
  // previous one's pending writes.
  const store = useMemo(
    () =>
      makePendingFlowStore({
        storage,
        key: `pending-flows:${scope}`,
        anonymous: scope === ANONYMOUS_WORKSPACE_SCOPE,
      }),
    [scope, storage],
  );

  usePendingFlowSettlement({
    channel,
    store,
    maxAgeMs,
    ...(readStatus === undefined ? {} : { readStatus }),
    onFailure: failure => {
      toasts?.showFailure(failure);
    },
  });

  if (toasts === undefined)
    throw new Error(
      'PendingFlowsProvider must sit inside a ToastProvider: a failed flow has nowhere else to be shown',
    );

  return (
    <PendingFlowStoreProvider store={store}>
      {children}
    </PendingFlowStoreProvider>
  );
}
