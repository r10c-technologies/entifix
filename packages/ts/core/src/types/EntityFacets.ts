import type { Entity } from './Entity.js';
import type { EntityFiltering } from './EntityFiltering.js';

/**
 * One member to count the values of, under its own filtering.
 *
 * Each facet carries its own filtering rather than sharing one, because the
 * counts a shop shows are usually **disjunctive**: a brand facet is counted
 * under every filter except the brand choice itself, so choosing one brand
 * does not drop every other brand to zero. Which filters a facet leaves out is
 * the caller's to say — the counter counts what it is asked to.
 */
export interface EntityFacetQuery<TEntity extends Entity = Entity> {
  readonly member: keyof TEntity & string;
  readonly filtering?: EntityFiltering<TEntity>[];
}

/** One value a member holds, and how many records hold it. */
export interface EntityFacetValue {
  readonly value: string | number | boolean;
  readonly count: number;
}

/**
 * The values each queried member holds, keyed by the member as it was asked
 * for. Every queried member is present; one no record holds is an empty list.
 * A value held by no record is absent rather than counted `0`, since the
 * counter cannot know which values the caller offers.
 *
 * Ordered by count, highest first, then by value.
 */
export type EntityFacetCounts = Readonly<
  Record<string, readonly EntityFacetValue[]>
>;
