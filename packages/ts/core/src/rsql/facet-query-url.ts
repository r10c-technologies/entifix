import { EntifixBuildError } from '../base-entities/entifix-error/index.js';
import type { Entity, EntityConstructor } from '../types/Entity.js';
import type { EntityFacetQuery } from '../types/EntityFacets.js';
import {
  allowedDescriptors,
  coerceFiltering,
  resolveAllowedProperty,
} from './coerce-rsql.js';
import { RSQL_PARAM } from './load-request-url.js';
import { parseRsql } from './parse-rsql.js';
import { serializeRsql } from './serialize-rsql.js';

/** The parameter naming one member to count, repeated once per facet. */
export const FACET_PARAM = 'facet';

/** The parameter holding one facet's own filtering: `rsql.<member>`. */
export const facetFilterParam = (member: string): string =>
  `${RSQL_PARAM}.${member}`;

/**
 * Serializes facet queries into query parameters: each member as a `facet`,
 * and each one's filtering as RSQL under `rsql.<member>` — omitted when it
 * filters nothing, so an unfiltered count keeps a clean URL.
 */
export function serializeFacetQueryParams<TEntity extends Entity>(
  queries: readonly EntityFacetQuery<TEntity>[],
): URLSearchParams {
  const params = new URLSearchParams();
  for (const { member, filtering } of queries) {
    params.append(FACET_PARAM, member);
    const rsql = serializeRsql(filtering);
    if (rsql !== '') params.set(facetFilterParam(member), rsql);
  }
  return params;
}

/**
 * Parses query parameters into facet queries, validated against the entity's
 * own metadata — the server-side half of the facet protocol, and the same
 * allowlist a load uses.
 *
 * A counted member must be `filterable`: a count is a question about the
 * values a filter would choose between, and counting a member nobody may
 * filter on would read out values the entity chose not to expose. A
 * `localized` member is refused, since its value is a record of texts, not one
 * to count. Every failure is an {@link EntifixBuildError}, so a `400`.
 */
export function parseFacetQueryParams<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  params: URLSearchParams,
): EntityFacetQuery<TEntity>[] {
  const members = params.getAll(FACET_PARAM);
  if (members.length === 0) {
    throw new EntifixBuildError(`name at least one "${FACET_PARAM}"`);
  }
  if (new Set(members).size !== members.length) {
    throw new EntifixBuildError(
      `a "${FACET_PARAM}" is named twice`,
      undefined,
      {
        members,
      },
    );
  }

  const allowed = allowedDescriptors(
    entityConstructor,
    descriptor => descriptor.filterable,
  );

  return members.map(member => {
    const { key, locale } = resolveAllowedProperty(
      allowed,
      member,
      'filterable',
    );
    if (locale !== undefined) {
      // One locale of a localized member is prose, one value per record —
      // there is nothing to choose between, so nothing to count.
      throw new EntifixBuildError(`"${member}" cannot be counted`, undefined, {
        member,
      });
    }
    const expression = params.get(facetFilterParam(member));
    return {
      member: key as keyof TEntity & string,
      ...(expression?.trim()
        ? {
            filtering: [
              coerceFiltering(entityConstructor, parseRsql(expression)),
            ],
          }
        : {}),
    };
  });
}
