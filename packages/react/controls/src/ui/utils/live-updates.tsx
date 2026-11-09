'use client';

import { createContext, type ReactNode, useContext } from 'react';

/**
 * Where the tab's live updates stand: `open`, or a dropped stream —
 * `reconnecting` while the transport retries, `closed` once it gave up.
 */
export type LiveConnection = 'open' | 'reconnecting' | 'closed';

/** The connection, and the way to try again now when the host has one. */
export interface LiveUpdates {
  readonly connection: LiveConnection;
  readonly reconnect?: () => void;
}

const LiveUpdatesContext = createContext<LiveUpdates>({ connection: 'open' });

/**
 * Publishes the push connection to the controls — the top bar's indicator, a
 * pending write's label — which cannot read it themselves: the channel is
 * `@entifix/react-integration`'s, and this package never imports it. A host's
 * shell provides it; without one, updates read as live.
 */
export function LiveUpdatesProvider({
  value,
  children,
}: {
  value: LiveUpdates;
  children: ReactNode;
}) {
  return (
    <LiveUpdatesContext.Provider value={value}>
      {children}
    </LiveUpdatesContext.Provider>
  );
}

/** The live connection as the nearest {@link LiveUpdatesProvider} states it. */
export const useLiveUpdates = (): LiveUpdates => useContext(LiveUpdatesContext);
