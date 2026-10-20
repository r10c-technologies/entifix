import { EntifixBuildError } from '../../base-entities/entifix-error/index.js';
import { ROW_KEY } from '../../types/EntityRowDraft.js';
import type { ChildConstructor } from '../meta-entities/meta-accessor/index.js';
import {
  describeEntityColumns,
  type EntityFieldDescriptor,
} from './describe-entity-columns.js';

/**
 * The columns of one row of an owned collection.
 *
 * Thin over {@link describeEntityColumns}, which already accepts a
 * `ChildConstructor` — a child is described by its accessors and needs no
 * `@entity()` ([ADR 0034](../../../../../../../docs/adr/0034-composition-metadata.md)).
 * What this adds is the one rule a row has and an entity does not.
 *
 * **A child may not declare `$key`.** That name is the row's minted client
 * identity, and a member of the same name would be overwritten by it — the row
 * would re-key on every keystroke, drop focus mid-word, and address another
 * row's errors. Throwing is the only honest option: silently renaming the
 * member would write the wrong column, and preferring the member over the key
 * would leave the grid with no identity at all.
 *
 * **Nor a `localized` member**, for a reason of the same kind: a row's draft is a
 * flat string map, and a text per locale has no single cell to live in.
 *
 * `EntifixBuildError` rather than a logic error, because this is a declaration
 * fault in the entity — the same class `assertNotQueryable` raises when a
 * collection claims to be sortable.
 */
export function describeChildColumns<TChild extends object>(
  childType: ChildConstructor<TChild>,
  sample?: TChild,
): EntityFieldDescriptor[] {
  const descriptors = describeEntityColumns(childType, sample);
  const reserved = descriptors.find(descriptor => descriptor.name === ROW_KEY);

  if (reserved !== undefined) {
    throw new EntifixBuildError(
      `A composition child declares a member named \`${ROW_KEY}\`, which is reserved ` +
        'for the row’s client-side key. Rename the member: the key and the member ' +
        'cannot share a name, and the row would lose its identity on every edit.',
      undefined,
      { member: ROW_KEY },
    );
  }

  // A row's draft is a flat string map, which is what keeps a draft's type
  // bounded for the form engine; a text per locale has no cell to live in.
  const localized = descriptors.find(
    descriptor => descriptor.type === 'localized',
  );
  if (localized !== undefined) {
    throw new EntifixBuildError(
      `A composition child declares "${localized.name}" as localized, which a row ` +
        'cannot hold: a row is a flat string map. Keep the localized text on the ' +
        'entity, or make the child an entity of its own.',
      undefined,
      { member: localized.name },
    );
  }

  return descriptors;
}

/**
 * The columns a detail grid actually edits.
 *
 * A read-only member still has a column — it is shown, just not written, exactly
 * as a form shows one. What is dropped is a **nested collection**: a child that
 * owns rows of its own would need a grid inside a grid, and `reconstructChild`
 * is one level deep by decision. Dropping it here rather than rendering a
 * disabled cell keeps that decision in one place.
 */
export function editableChildColumns(
  descriptors: readonly EntityFieldDescriptor[],
): EntityFieldDescriptor[] {
  return descriptors.filter(
    descriptor =>
      descriptor.type !== 'composition' &&
      descriptor.type !== 'linkCollection' &&
      descriptor.type !== 'link',
  );
}
