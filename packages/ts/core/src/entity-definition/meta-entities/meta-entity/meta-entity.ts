import type { Entity } from '../../../types/Entity.js';
import type { EntityFiltering } from '../../../types/EntityFiltering.js';
import type { EntitySorting } from '../../../types/EntitySorting.js';
import { assertBounds } from '../bounds.js';

/**
 * An entity a view's filtering names members of. `@entity()` is applied before
 * TypeScript knows which class it decorates, so a view's members cannot be
 * checked against it there; `extractEntityView` checks them when the view is
 * first read instead.
 */
type AnyEntity = Entity & Record<string, unknown>;

/**
 * A narrower shape an entity is published in: some records left out, some
 * members omitted — posts without their bodies, drafts left out.
 *
 * Read by `serializeEntityCollection(entity, records, { view })` and by any
 * adapter that publishes records, so the shape is declared once on the entity
 * rather than per consumer. A member a view omits is optional **in that view
 * only**: `validateRecords(…, { view })` does not require it, and `required`
 * keeps its meaning for the full record.
 */
export interface EntityViewOptions {
  /** The records the view keeps, as a load request filters them. */
  readonly filtering?: readonly EntityFiltering<AnyEntity>[];
  /** The order the view lists them in. */
  readonly sorting?: readonly EntitySorting<AnyEntity>[];
  /** Members, by accessor name, the view leaves out. */
  readonly omit?: readonly string[];
}

/**
 * How many records an entity may have: `{ min: 1, max: 1 }` for a site's one
 * profile, `{ min: 1 }` for "at least one". Checked by `validateRecords` over a
 * whole set of records — a static build's content, an import — and never by a
 * single save, which cannot see the others.
 */
export interface EntityCardinality {
  readonly min?: number;
  readonly max?: number;
}

export interface MetaEntityOptions {
  key?: string;
  domain?: string;
  /** Translation key for the entity's singular name, e.g. `entity:product-specification.label`. */
  labelKey?: string;
  /** Translation key for its plural, e.g. `entity:product-specification.plural`. */
  pluralKey?: string;
  /** How many records the entity may have. */
  cardinality?: EntityCardinality;
  /** Named shapes the entity is published in, by view name. */
  views?: Readonly<Record<string, EntityViewOptions>>;
}

export class MetaEntity {
  //#region Properties
  readonly name: string;
  readonly key?: string;
  readonly domain?: string;
  readonly labelKey?: string;
  readonly pluralKey?: string;
  readonly cardinality?: EntityCardinality;
  readonly views?: Readonly<Record<string, EntityViewOptions>>;
  //#endregion

  //#region Constructors
  constructor(name: string, options?: MetaEntityOptions) {
    this.name = name;
    this.key = options?.key;
    this.domain = options?.domain;
    this.labelKey = options?.labelKey;
    this.pluralKey = options?.pluralKey;
    assertBounds(`${name}'s cardinality`, options?.cardinality);
    this.cardinality = options?.cardinality;
    this.views = options?.views;
  }
  //#endregion

  //#region Methods
  //#endregion

  //#region Accessors
  //#endregion
}
