import type { Entity, EntityConstructor } from '../../../types/Entity.js';
import { assertEntityStates, setMetaEntity } from '../../helpers/index.js';
import {
  MetaEntity,
  MetaEntityOptions,
} from '../../meta-entities/meta-entity/index.js';

export function entity<TEntity extends Entity>(options?: MetaEntityOptions) {
  return (
    target: EntityConstructor<TEntity>,
    context: ClassDecoratorContext,
  ) => {
    setMetaEntity(context.metadata, new MetaEntity(target.name, options));
    // The states name members, and a class decorator runs before the class
    // carries its metadata; an initializer runs once it does.
    if (
      options?.writableWhen !== undefined ||
      options?.deletableWhen !== undefined
    ) {
      context.addInitializer(function (this: unknown) {
        assertEntityStates(this as EntityConstructor<Entity>);
      });
    }
  };
}
