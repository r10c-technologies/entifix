import type { Relevance } from '../query/relevance.js';
import type { Entity } from './Entity.js';

export type EntitySortType = 'asc' | 'desc';

/**
 * A request's order, keyed by priority. A key is a member the entity declares
 * `sortable`, or {@link Relevance} — the order of a search by how well each
 * record matches its `like` words (ADR 0033).
 */
export type EntitySorting<TEntity extends Entity> = Record<
  number,
  {
    property: keyof TEntity | Relevance;
    type: EntitySortType;
  }
>;
