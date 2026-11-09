'use client';

import {
  EntityIdTag,
  type EntityRepositoryTag,
  getUCFactory,
} from '@entifix/business';
import {
  type Entity,
  type EntityConstructor,
  isLocalizedText,
  type Locale,
  localize,
} from '@entifix/core';
import { Skeleton, useLocale } from '@entifix/react-controls';
import { entityQueryScope } from '@entifix/react-integration';
import { useQueries } from '@tanstack/react-query';
import { Context, Effect } from 'effect';

/** One member a list shows as the record it names, and where to read it. */
export interface LinkLabelPlan {
  readonly field: string;
  readonly entityConstructor: EntityConstructor<Entity>;
  readonly labelProperty: string;
  readonly ctx: Context.Context<EntityRepositoryTag>;
}

/** What a list cell knows about the record an id names. */
export type LinkLabel =
  | { readonly state: 'resolving' }
  | { readonly state: 'named'; readonly label: string }
  | { readonly state: 'unnamed' };

const idOf = (item: Entity, field: string): string | undefined => {
  const raw = (item as unknown as Record<string, unknown>)[field];
  return raw == null || raw === '' ? undefined : String(raw);
};

/** A target's label member as a reader sees it: localized, or as text. */
export const targetLabel = (
  raw: unknown,
  locale: Locale,
): string | undefined =>
  isLocalizedText(raw)
    ? localize(raw, locale)
    : raw == null || raw === ''
      ? undefined
      : String(raw);

/**
 * The records a page of rows refers to by id, read once per distinct id and
 * cached under the target's own scope, so a list column can name each one
 * rather than print its key (#200).
 */
export function useLinkLabels(
  plans: readonly LinkLabelPlan[],
  items: readonly Entity[],
): (field: string, item: Entity) => LinkLabel | undefined {
  const locale = useLocale();
  const requests = plans.flatMap(plan =>
    [
      ...new Set(
        items
          .map(item => idOf(item, plan.field))
          .filter((id): id is string => id !== undefined),
      ),
    ].map(id => ({ plan, id })),
  );

  const results = useQueries({
    queries: requests.map(({ plan, id }) => ({
      queryKey: [...entityQueryScope(plan.entityConstructor), 'label', id],
      queryFn: () =>
        Effect.runPromise(
          Effect.provide(
            getUCFactory<Entity>(),
            plan.ctx.pipe(Context.add(EntityIdTag, id)),
          ),
        ),
    })),
  });

  const byKey = new Map(
    requests.map(({ plan, id }, index) => [
      `${plan.field}\u0000${id}`,
      { plan, result: results[index] },
    ]),
  );

  return (field, item) => {
    const id = idOf(item, field);
    if (id === undefined) return undefined;
    // Every id on the page was asked for above, so the entry is there.
    const { plan, result } = byKey.get(`${field}\u0000${id}`) as {
      plan: LinkLabelPlan;
      result: (typeof results)[number];
    };
    if (result.isPending) return { state: 'resolving' };
    const raw = (result.data as Record<string, unknown> | undefined)?.[
      plan.labelProperty
    ];
    const label = targetLabel(raw, locale);
    return label === undefined
      ? { state: 'unnamed' }
      : { state: 'named', label };
  };
}

/** A list cell for an id: the record's name, a skeleton while it is read. */
export function LinkLabelCell({ label }: { label: LinkLabel | undefined }) {
  if (label?.state === 'resolving')
    return <Skeleton shape="line" className="w-16" />;
  if (label?.state === 'named') return <span>{label.label}</span>;
  return <span className="text-content-muted">—</span>;
}
