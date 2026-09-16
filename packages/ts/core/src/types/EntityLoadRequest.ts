import type { Entity } from './Entity.js';
import type { EntityFiltering } from './EntityFiltering.js';
import type { EntitySorting } from './EntitySorting.js';

export interface EntityLoadRequest<TEntity extends Entity = Entity> {
  filtering?: EntityFiltering<TEntity>[];
  sorting?: EntitySorting<TEntity>[];
  page?: number;
  pageSize?: number;
}
