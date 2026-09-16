import type { Entity } from './Entity.js';
import type { EntityLoadRequest } from './EntityLoadRequest.js';

export interface EntityPage<TEntity extends Entity> {
  items: TEntity[];
  total: number;
  request: EntityLoadRequest<TEntity>;
}
