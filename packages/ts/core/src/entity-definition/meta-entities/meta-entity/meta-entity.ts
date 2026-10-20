import { assertBounds } from '../bounds.js';

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
}

export class MetaEntity {
  //#region Properties
  readonly name: string;
  readonly key?: string;
  readonly domain?: string;
  readonly labelKey?: string;
  readonly pluralKey?: string;
  readonly cardinality?: EntityCardinality;
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
  }
  //#endregion

  //#region Methods
  //#endregion

  //#region Accessors
  //#endregion
}
