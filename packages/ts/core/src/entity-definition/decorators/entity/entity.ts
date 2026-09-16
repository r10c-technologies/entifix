import type { Entity, EntityConstructor } from '../../../types/Entity.js';
import { setMetaEntity } from '../../helpers/index.js';
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
  };
}
