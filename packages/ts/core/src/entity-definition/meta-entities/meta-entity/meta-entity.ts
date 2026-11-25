import type { Entity } from '../../../types/Entity.js';
import type { EntityFiltering } from '../../../types/EntityFiltering.js';
import type { EntitySorting } from '../../../types/EntitySorting.js';
import { assertBounds } from '../bounds.js';
import type { UseCaseAvailability } from '../meta-use-case/meta-use-case.js';

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
  /**
   * `false` for an entity no person creates — one only ever written by a flow,
   * such as an order a checkout opens. A list of it offers no "New", whatever
   * the caller holds; absent, it offers one to a caller who may write it
   * ([ADR 0026](../../../../../../../docs/adr/0026-actions-hierarchy-overflow-and-destructive-verbs.md)).
   */
  creatable?: boolean;
  /**
   * The member a record is called by — a `string`, a `localized`, a `number`
   * or a reference, in which case the record is called by its target's name.
   * Every surface that names a record (a row, a card's heading, a confirm
   * dialog, a breadcrumb, a toast) reads it through `recordLabel()`.
   * Undeclared, the first filled-in text member that is not a key is used —
   * never a number, an enum or a date, which hold a value rather than a name;
   * with none, the record is the noun and its short id. Checked
   * when the entity is described: a member that does not exist, is hidden or
   * is a collection fails
   * ([ADR 0030](../../../../../../../docs/adr/0030-a-reference-names-its-target-through-the-owners-read-port.md)).
   */
  labelMember?: string;
  /**
   * The states a record must hold for a person to save it: its `member` — an
   * `enumValues` accessor, by its own name — holds one of `in`. Outside them
   * the form renders the record read-only with no Save, a table offers no edit
   * on its row, and the service refuses the update with `unavailableInState`
   * in the same conditional write that saves it
   * ([ADR 0029](../../../../../../../docs/adr/0029-a-verb-declares-the-states-it-is-legal-from.md)).
   * Absent, every record may be saved. Requires {@link readOnlyReasonKey}.
   */
  writableWhen?: UseCaseAvailability;
  /**
   * The states a record must hold to be deleted, by the same rule as
   * {@link writableWhen}: hidden outside them, refused by the store's own
   * conditional delete.
   */
  deletableWhen?: UseCaseAvailability;
  /**
   * Catalog key for the one line a read-only form shows at its top, saying why
   * — "This version is released; create a new version to change it." Required
   * with {@link writableWhen}: a form that quietly stops accepting input reads
   * as broken.
   */
  readOnlyReasonKey?: string;
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
  readonly creatable: boolean;
  readonly labelMember?: string;
  readonly writableWhen?: UseCaseAvailability;
  readonly deletableWhen?: UseCaseAvailability;
  readonly readOnlyReasonKey?: string;
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
    this.creatable = options?.creatable ?? true;
    this.labelMember = options?.labelMember;
    if (
      options?.writableWhen !== undefined &&
      options.readOnlyReasonKey === undefined
    ) {
      throw new Error(
        `${name} declares \`writableWhen\` and no \`readOnlyReasonKey\`: a form outside its write states must say why it takes no input.`,
      );
    }
    this.writableWhen = options?.writableWhen;
    this.deletableWhen = options?.deletableWhen;
    this.readOnlyReasonKey = options?.readOnlyReasonKey;
  }
  //#endregion

  //#region Methods
  //#endregion

  //#region Accessors
  //#endregion
}
