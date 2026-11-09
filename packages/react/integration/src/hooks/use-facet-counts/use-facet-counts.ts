import { EntityFacetCounterTag, facetCountsUCFactory } from '@entifix/business';
import type {
  Entity,
  EntityFacetCounts,
  EntityFacetQuery,
  EntityFiltering,
  FilterGroup,
} from '@entifix/core';
import { useQuery } from '@tanstack/react-query';
import { type Context, Effect } from 'effect';

/** A member to count, by its accessor name and its wire key. */
export interface FacetMember {
  readonly name: string;
  readonly key: string;
}

export interface UseFacetCountsOptions<TEntity extends Entity> {
  /** Where a facet counter runs. Without one nothing is counted. */
  readonly ctx: Context.Context<EntityFacetCounterTag> | undefined;
  /** The members to count — an enum's or a boolean's, typically. */
  readonly members: readonly FacetMember[];
  /** The filtering the list is under. */
  readonly filtering: FilterGroup<TEntity> | undefined;
  /**
   * The entity's query scope, so an invalidation that refreshes the list
   * refreshes its counts with it.
   */
  readonly scope: readonly unknown[];
}

/**
 * The filtering a member is counted under: the list's own, less any filter on
 * that member — so choosing one value does not drop every other value's count
 * to zero. Only an `and` group can lose a clause and stay a narrowing of the
 * same list; an `or` group is counted as it stands.
 */
function withoutMember<TEntity extends Entity>(
  filtering: FilterGroup<TEntity>,
  member: FacetMember,
): FilterGroup<TEntity> {
  if (filtering.operator !== 'and') return filtering;
  return {
    ...filtering,
    values: filtering.values.filter(
      node =>
        !('property' in node) ||
        (String(node.property) !== member.name &&
          String(node.property) !== member.key),
    ),
  };
}

/**
 * How many records hold each value of each member, under the list's filtering
 * ([ADR 0012](../../../../../../docs/adr/0012-facet-counts-are-a-port-of-their-own.md)),
 * for a filter panel to show beside its choices. `undefined` until counted, and
 * always without a counter.
 */
export function useFacetCounts<TEntity extends Entity>({
  ctx,
  members,
  filtering,
  scope,
}: UseFacetCountsOptions<TEntity>): EntityFacetCounts | undefined {
  const queries: EntityFacetQuery<TEntity>[] = members.map(member => ({
    member: member.name as keyof TEntity & string,
    ...(filtering === undefined
      ? {}
      : {
          filtering: [
            withoutMember(filtering, member) as EntityFiltering<TEntity>,
          ],
        }),
  }));

  const { data } = useQuery({
    enabled: ctx !== undefined && members.length > 0,
    queryKey: [...scope, '$facets', queries],
    queryFn: () =>
      Effect.runPromise(
        Effect.provide(
          facetCountsUCFactory(queries),
          ctx as Context.Context<EntityFacetCounterTag>,
        ),
      ),
  });
  return data;
}
