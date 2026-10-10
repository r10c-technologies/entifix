import type { EntityRepository } from '@entifix/business';

/**
 * Where a repository comes from: asked for when a hook first needs it.
 *
 * A source may build its repository lazily — fetch a file, open a client —
 * and should keep it once built, since a filter asks again on every change.
 */
export type EntitySource = () => Promise<EntityRepository>;
