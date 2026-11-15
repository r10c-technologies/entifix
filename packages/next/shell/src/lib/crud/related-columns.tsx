'use client';

import {
  EntityLoadRequestTag,
  type EntityRepositoryTag,
  loadUCFactory,
} from '@entifix/business';
import {
  coerceFiltering,
  describeEntityColumns,
  type Entity,
  type EntityConstructor,
  type EntityFieldDescriptor,
  type EntityLoadRequest,
  extractMetaEntity,
  type FilterGroup,
  parseRsql,
  serializeRsql,
} from '@entifix/core';
import {
  CellValue,
  EntityColumn,
  useEntityNoun,
  useT,
  useTranslateKey,
} from '@entifix/react-controls';
import { entityQueryScope } from '@entifix/react-integration';
import { useQueries } from '@tanstack/react-query';
import { Context, Effect } from 'effect';
import type { ReactElement } from 'react';

import type { EntityCrudRelated } from './make-entity-crud.types.js';

/**
 * How many matches one related read asks for. A page names far fewer for a
 * `via` column; a `match` column whose records hold more than this per page
 * reads as the count of those it got.
 */
export const RELATED_PAGE_SIZE = 200;

/** A related column, checked when the screen is generated. */
export interface RelatedPlan<TAdapters> extends EntityCrudRelated<TAdapters> {
  /** The target member's descriptor: what a match's value reads as. */
  readonly descriptor: EntityFieldDescriptor;
  readonly entityKey: string;
}

/**
 * Checks every related column against both entities' metadata, so a mistake
 * throws when the screen is generated rather than answering `400` per page.
 */
export function planRelated<TAdapters>(
  entityConstructor: EntityConstructor<Entity>,
  descriptors: readonly EntityFieldDescriptor[],
  related: readonly EntityCrudRelated<TAdapters>[],
): RelatedPlan<TAdapters>[] {
  return related.map(column => {
    const name = `${entityConstructor.name}'s related column "${column.key}"`;
    if ((column.via === undefined) === (column.match === undefined)) {
      throw new Error(`${name} needs exactly one of via and match.`);
    }
    if (
      column.via !== undefined &&
      descriptors.find(entry => entry.name === column.via)?.references ===
        undefined
    ) {
      throw new Error(
        `${name} reads via "${column.via}", which is not a reference member of ${entityConstructor.name}.`,
      );
    }
    const target = describeEntityColumns(column.target);
    if (
      column.match !== undefined &&
      target.find(entry => entry.name === column.match)?.filterable !== true
    ) {
      throw new Error(
        `${name} matches on "${column.match}", which must be a filterable member of ${column.target.name}.`,
      );
    }
    const descriptor = target.find(entry => entry.name === column.member);
    if (descriptor === undefined) {
      throw new Error(
        `${name} shows "${column.member}", which is not a member of ${column.target.name}.`,
      );
    }
    // Through the target's own allowlist, as a service would coerce it.
    const rsql =
      column.filtering === undefined ? '' : serializeRsql([column.filtering]);
    if (rsql !== '') coerceFiltering(column.target, parseRsql(rsql));
    return {
      ...column,
      descriptor,
      entityKey: String(extractMetaEntity(column.target).key),
    };
  });
}

const valueOf = (record: Entity, member: string): unknown =>
  (record as unknown as Record<string, unknown>)[member];

const present = (value: unknown): value is string | number =>
  value !== undefined && value !== null && value !== '';

/**
 * One column per related plan, its values read for the page's items in one
 * request per column — keyed under the target's own query scope, so a write
 * to the target refreshes it.
 */
export function useRelatedColumns<TAdapters, TEntity extends Entity>(
  plans: readonly RelatedPlan<TAdapters>[],
  items: readonly TEntity[],
  repositoryOf: (
    plan: RelatedPlan<TAdapters>,
  ) => Context.Context<EntityRepositoryTag>,
): ReactElement[] {
  const translateKey = useTranslateKey();
  const t = useT('shell');
  const noun = useEntityNoun();

  const keysOf = (plan: RelatedPlan<TAdapters>) =>
    [
      ...new Set(
        items
          .map(item => valueOf(item, plan.via ?? 'id'))
          .filter(present)
          .map(String),
      ),
    ].sort();

  const results = useQueries({
    queries: plans.map(plan => {
      const keys = keysOf(plan);
      const property = plan.via === undefined ? (plan.match as string) : 'id';
      const filtering: FilterGroup<Entity> = {
        operator: 'and',
        values: [
          {
            property: property as never,
            operator: 'in',
            values: keys as never,
          },
          ...(plan.filtering === undefined
            ? []
            : [plan.filtering as FilterGroup<Entity>]),
        ],
      };
      const request: EntityLoadRequest = {
        filtering: [filtering],
        page: 1,
        pageSize: RELATED_PAGE_SIZE,
      };
      return {
        queryKey: [...entityQueryScope(plan.target), 'related', plan.key, keys],
        enabled: keys.length > 0,
        queryFn: () =>
          Effect.runPromise(
            Effect.provide(
              loadUCFactory<Entity>(),
              repositoryOf(plan).pipe(
                Context.add(EntityLoadRequestTag, request),
              ),
            ),
          ).then(page => page.items),
      };
    }),
  });

  return plans.map((plan, index) => {
    const matches = results[index]?.data ?? [];
    const matchesOf = (item: TEntity) => {
      const key = valueOf(item, plan.via ?? 'id');
      if (!present(key)) return [];
      return matches.filter(match =>
        plan.via === undefined
          ? String(valueOf(match, plan.match as string)) === String(key)
          : String(match.id) === String(key),
      );
    };
    const plural = noun(extractMetaEntity(plan.target), 'plural');
    return (
      <EntityColumn<TEntity>
        key={plan.key}
        field={plan.key}
        label={translateKey(plan.labelKey)}
        type={plan.descriptor.type}
        {...(plan.descriptor.minWidth === undefined
          ? {}
          : { minWidth: plan.descriptor.minWidth })}
        render={item => {
          const found = matchesOf(item);
          const [only] = found;
          if (only === undefined || found.length > 1) {
            return found.length > 1 ? (
              <span>
                {t('related.count', { count: found.length, noun: plural })}
              </span>
            ) : (
              <span className="text-content-muted">—</span>
            );
          }
          return plan.render === undefined ? (
            <CellValue
              value={valueOf(only, plan.member)}
              descriptor={plan.descriptor}
              record={only as unknown as Record<string, unknown>}
            />
          ) : (
            plan.render(only)
          );
        }}
      />
    );
  });
}
