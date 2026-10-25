import type { EntifixConnError } from '@entifix/core';
import { Context, type Effect } from 'effect';

/** One organization's storage, as a {@link TenantDirectory} lists it. */
export interface TenantEntry<THandle> {
  readonly organizationId: string;
  readonly handle: THandle;
}

/**
 * Every organization's storage for one per-organization store.
 *
 * The other half of {@link TenantDatabaseResolver}: that one answers a
 * request about **one** organization; this one is for the background work
 * that has to visit **all** of them — an outbox relay, an expiry sweep, a
 * rebuild walk. A request handler never needs it, and should not have it.
 *
 * Enumerating is only legitimate for the slice that writes the store being
 * enumerated. A process listing another slice's tenant databases is reading
 * storage it does not own.
 */
export interface TenantDirectory<THandle> {
  readonly list: () => Effect.Effect<
    readonly TenantEntry<THandle>[],
    EntifixConnError
  >;
}

/**
 * DI tag for the directory, with an `unknown` handle for the reason
 * {@link TenantDatabaseResolverTag} gives: the composition root narrows it.
 */
export class TenantDirectoryTag extends Context.Service<
  TenantDirectoryTag,
  TenantDirectory<unknown>
>()('TenantDirectoryTag') {}
