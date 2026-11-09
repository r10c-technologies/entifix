import { useCallback, useSyncExternalStore } from 'react';

import type { PushChannel, PushConnection } from './push-channel.js';

/** A push channel's state, and the way to try again now. */
export interface PushConnectionState {
  readonly connection: PushConnection;
  readonly reconnect: () => void;
}

/**
 * Where the tab's push stream stands — `open`, `reconnecting` or `closed` —
 * re-rendering when it moves, so a screen can say live updates are paused
 * rather than leaving a pending write waiting without a word (ADR 0028).
 */
export function usePushConnection(channel: PushChannel): PushConnectionState {
  const connection = useSyncExternalStore(
    channel.onConnectionChange,
    channel.connection,
    // A server render has no stream; it is not news there either.
    () => 'open' as const,
  );
  const reconnect = useCallback(() => channel.reconnect(), [channel]);
  return { connection, reconnect };
}
