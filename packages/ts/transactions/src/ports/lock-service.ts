import type { Contention, StoreFailure } from '@entifix/core';
import { Context, type Effect } from 'effect';

/** A held lock; `token` proves ownership so release only frees our own lock. */
export interface LockHandle {
  key: string;
  token: string;
}

/**
 * Distributed mutual exclusion — the facade's `lock`/`free` steps. Implemented
 * over Redis (`SET NX PX` + bounded retry) in `@entifix/redis`.
 */
export interface LockService {
  /**
   * Acquire `key`, retrying up to the adapter's bounded budget. Fails with
   * {@link Contention} on contention (surfaced as `409`), not a `500`.
   */
  acquire(key: string): Effect.Effect<LockHandle, StoreFailure>;
  release(handle: LockHandle): Effect.Effect<void, StoreFailure>;
}

export class LockServiceTag extends Context.Service<
  LockServiceTag,
  LockService
>()('LockServiceTag') {}
