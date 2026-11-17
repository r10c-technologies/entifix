import { extractMetaAccessors } from './helpers/index.js';
import type { ChildConstructor } from './meta-entities/meta-accessor/index.js';

/**
 * The increment a write that changes a revisioned record states, so a verb's
 * conditional write moves the revision in the same statement instead of
 * re-deriving it (ADR 0032 §6). A form opened before the verb then saves at a
 * revision that no longer matches, and the check protects something.
 *
 * Two spellings of one rule, each for an engine whose operators core does not
 * import: a Mongo update document to merge into the write's own, and a SQL
 * assignment to add to its `SET` list.
 */
export const bumpRevision = {
  mongo: { $inc: { revision: 1 } },
  sql: 'revision = revision + 1',
} as const;

/** The one name a revision member may have: the wire key is part of the contract. */
export const REVISION_KEY = 'revision';

/** Whether `entityConstructor` declares a `revision` member (ADR 0032). */
export function declaresRevision(entityConstructor: ChildConstructor): boolean {
  return extractMetaAccessors(entityConstructor).some(
    member => member.type === 'revision',
  );
}

/**
 * The revision a record holds, or `undefined` when it holds none — a record
 * never saved, or one an author left without. Anything but a finite number is
 * none: a save must not be conditional on a value it cannot compare.
 */
export function readRevision(entity: unknown): number | undefined {
  const value = (entity as { revision?: unknown } | null | undefined)?.revision;
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}
