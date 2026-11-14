import {
  describeEntityColumns,
  type EntifixFailure,
  type Entity,
  type EntityConstructor,
  type EntityFieldDescriptor,
  type EntityId,
  entityReferenceKey,
  extractMetaEntity,
  Internal,
  type LocalizedText,
  recordLabel,
} from '@entifix/core';
import { Context, Effect } from 'effect';

import { EntityRepositoryTag } from './entity.repository.js';

/**
 * What a referenced record is called: a text, or a text per locale for the
 * reader's locale to pick from.
 */
export type ReferenceLabel = string | LocalizedText;

/**
 * Reads what the records a reference points at are called, by the entity's
 * `domain:key` and their ids
 * ([ADR 0030](../../../../../docs/adr/0030-a-reference-names-its-target-through-the-owners-read-port.md)).
 *
 * An id with no record — deleted, or one the reader may not read — is absent
 * from the map rather than an error: one name that cannot be read does not
 * fail a list that loaded. A failure is the read itself failing.
 */
export interface ReferenceLabels {
  /** The entity keys this registry can name. */
  readonly entities: ReadonlyMap<string, EntityConstructor<Entity>>;
  resolve(
    entityKey: string,
    ids: readonly string[],
  ): Effect.Effect<ReadonlyMap<string, ReferenceLabel>, EntifixFailure>;
}

/** DI tag for the host's {@link ReferenceLabels} registry. */
export class ReferenceLabelsTag extends Context.Service<
  ReferenceLabelsTag,
  ReferenceLabels
>()('ReferenceLabelsTag') {}

/** How a registered target is named. */
export interface ReferenceLabelOptions {
  /**
   * The target's member a record is called by. Defaults to the target's own
   * `labelMember`, and then to its record label's undeclared rung.
   */
  readonly labelProperty?: string;
}

/** Maps a target entity to the repository adapter that reads it, and how its records are named. */
export type ReferenceLabelRegistration = readonly [
  EntityConstructor<Entity>,
  Context.Context<EntityRepositoryTag>,
  ReferenceLabelOptions?,
];

/**
 * How many ids one read asks for. A page names far fewer; the bound keeps a
 * filter's URL and a server's page-size cap out of reach for whatever does not.
 */
export const REFERENCE_BATCH_SIZE = 100;

const NAMEABLE: readonly string[] = ['string', 'number', 'localized'];

/**
 * A label must be one hop: the member it reads is a text or a number on the
 * target itself, never another reference — or naming one record would read a
 * third.
 */
function labelDescriptor(
  entityConstructor: EntityConstructor<Entity>,
  labelProperty: string | undefined,
): EntityFieldDescriptor | undefined {
  const declared =
    labelProperty ?? extractMetaEntity(entityConstructor).labelMember;
  if (declared === undefined) return undefined;
  const descriptor = describeEntityColumns(entityConstructor).find(
    column => column.name === declared,
  );
  if (
    descriptor === undefined ||
    descriptor.references !== undefined ||
    !NAMEABLE.includes(descriptor.type)
  ) {
    throw new Error(
      `${entityConstructor.name} is named by "${declared}", which must be a visible string, number or localized member of it — a reference label is read in one hop.`,
    );
  }
  return descriptor;
}

function nameOf(
  entityConstructor: EntityConstructor<Entity>,
  descriptor: EntityFieldDescriptor | undefined,
  record: Entity,
): ReferenceLabel | undefined {
  const value =
    descriptor === undefined
      ? (() => {
          const label = recordLabel(entityConstructor, record);
          return label.kind === 'value' ? label.value : undefined;
        })()
      : (record as unknown as Record<string, unknown>)[descriptor.name];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'object') {
    const filled = Object.values(value).some(
      text => typeof text === 'string' && text !== '',
    );
    return filled ? (value as LocalizedText) : undefined;
  }
  return String(value);
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size));
  }
  return out;
}

/**
 * Assembles a {@link ReferenceLabelsTag} from repository adapters that already
 * exist, exactly as `createEntityLinkResolver` does — composed by the **host**,
 * where every target's adapter is in reach.
 *
 * Each `resolve` is **one read per target entity**: a `load` filtered
 * `id=in=(…)` over the distinct ids, page size equal to their count, through
 * the owner's own read path. The target's `id` must be filterable.
 *
 * Registration throws on a target registered twice, on one with no
 * `domain:key`, and on a label member that is not a scalar of the target.
 */
export function createReferenceLabels(
  registrations: ReadonlyArray<ReferenceLabelRegistration>,
): Context.Context<ReferenceLabelsTag> {
  const entities = new Map<string, EntityConstructor<Entity>>();
  const readers = new Map<
    string,
    (
      ids: readonly string[],
    ) => Effect.Effect<ReadonlyMap<string, ReferenceLabel>, EntifixFailure>
  >();

  for (const [entityConstructor, repositoryContext, options] of registrations) {
    const key = entityReferenceKey(entityConstructor);
    if (entities.has(key)) {
      throw new Error(
        `"${key}" is registered twice — one target entity is read through one repository.`,
      );
    }
    const repository = Context.get(repositoryContext, EntityRepositoryTag);
    const descriptor = labelDescriptor(
      entityConstructor,
      options?.labelProperty,
    );
    entities.set(key, entityConstructor);
    readers.set(key, ids =>
      Effect.forEach(
        chunks(ids, REFERENCE_BATCH_SIZE),
        batch =>
          repository.load<Entity>({
            filtering: [
              {
                property: 'id',
                operator: 'in',
                values: batch as EntityId[],
              },
            ],
            page: 1,
            pageSize: batch.length,
          }),
        { concurrency: 'unbounded' },
      ).pipe(
        Effect.map(pages => {
          const labels = new Map<string, ReferenceLabel>();
          for (const record of pages.flatMap(page => page.items)) {
            const name = nameOf(entityConstructor, descriptor, record);
            if (name !== undefined) labels.set(String(record.id), name);
          }
          return labels;
        }),
      ),
    );
  }

  const labels: ReferenceLabels = {
    entities,
    resolve(entityKey, ids) {
      const read = readers.get(entityKey);
      if (read === undefined) return Effect.fail(new Internal());
      const distinct = [...new Set(ids)];
      return distinct.length === 0 ? Effect.succeed(new Map()) : read(distinct);
    },
  };

  return Context.make(ReferenceLabelsTag, labels);
}
