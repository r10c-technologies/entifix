import { EntifixBuildError } from '../../base-entities/entifix-error/index.js';
import type { Entity, EntityConstructor } from '../../types/Entity.js';
import { extractMetaEntity } from '../helpers/index.js';
import type { EntityViewOptions } from '../meta-entities/meta-entity/index.js';
import {
  describeEntityColumns,
  type EntityFieldDescriptor,
} from './describe-entity-columns.js';

/** A view, resolved against the entity it belongs to. */
export interface EntityView extends EntityViewOptions {
  readonly name: string;
  /** The omitted members' descriptors, so a caller can drop them by wire key. */
  readonly omitted: readonly EntityFieldDescriptor[];
}

/**
 * One of an entity's named views, checked against the entity: a view it does
 * not declare, or one omitting a member it does not have, is a declaration
 * error rather than a view that silently publishes the whole record.
 *
 * The identity member cannot be omitted — a published record still has to say
 * which record it is.
 */
export function extractEntityView<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  name: string,
): EntityView {
  const meta = extractMetaEntity(entityConstructor);
  const view = meta.views?.[name];
  if (view === undefined) {
    throw new EntifixBuildError(
      `${meta.name} declares no view "${name}"; it declares ${JSON.stringify(
        Object.keys(meta.views ?? {}),
      )}.`,
    );
  }
  const descriptors = describeEntityColumns(entityConstructor);
  const omitted = (view.omit ?? []).map(member => {
    const descriptor = descriptors.find(each => each.name === member);
    if (descriptor === undefined || descriptor.name === 'id') {
      throw new EntifixBuildError(
        `${meta.name}'s view "${name}" omits "${member}", which is ${
          descriptor === undefined ? 'not a member of it' : 'its identity'
        }.`,
      );
    }
    return descriptor;
  });
  return { ...view, name, omitted };
}
