import { EntifixLogicError } from '../../../base-entities/entifix-error/index.js';
import { Entity } from '../../../types/Entity.js';
import { EntityCollectionLink } from '../entity-collection-link/index.js';
import { EntityLink } from '../entity-link/index.js';

/**
 * The record a resolved link names, read without a cast.
 *
 * `value` is `undefined` until the link is resolved, so reading it means a
 * non-null assertion at every call site. This reads it once, and a link
 * nothing resolved fails here, naming it, rather than as an `undefined` deep
 * in a render.
 */
export function targetOf<TEntity extends Entity>(
  link: EntityLink<TEntity>,
): TEntity {
  const { value } = link;
  if (value === undefined) {
    throw new EntifixLogicError(
      `The link to ${link.entityConstructor.name} ${String(link.id)} was read before it was resolved`,
    );
  }
  return value;
}

/** The records a resolved collection names, in its order. */
export function targetsOf<TEntity extends Entity>(
  links: EntityCollectionLink<TEntity>,
): TEntity[] {
  const { values } = links;
  if (values === undefined) {
    throw new EntifixLogicError(
      `The links to ${links.entityConstructor.name} were read before they were resolved`,
    );
  }
  return values;
}
