import type { EntityRepositoryTag } from '@entifix/business';
import type {
  Entity,
  EntityConstructor,
  EntityFieldDescriptor,
  EntityMetadataSource,
  EntityUseCaseRunner,
  FilterGroup,
} from '@entifix/core';
import type {
  EntityDraftStore,
  EntityLinkSourceConfig,
} from '@entifix/react-integration';
import type { Context } from 'effect/Context';
import type { CustomTypeOptions } from 'i18next';
import type { ReactElement, ReactNode } from 'react';

/**
 * The `entity` catalog keys that carry **both** form titles, a `label` and a
 * `plural`.
 *
 * Derived from the Spanish catalog rather than written out, so the union is the
 * catalog: an entity whose subtree has no `form.editTitle`/`form.newTitle`
 * cannot be handed to {@link makeEntityCrud} at all, and adding a reference
 * entity therefore starts by adding its copy to both locales. That is the whole
 * i18n gate for this factory — a host's catalog check typically scans its
 * domain packages for `@useCase()` decorators and never `.tsx`, so a runtime
 * key here would be checked by nothing.
 *
 * `label`/`plural` joined the condition when {@link EntityCrud} began carrying
 * them, so that a workspace tab and a nav entry derived from this descriptor
 * name the entity in the catalog's own words. They are part of the **type**
 * rather than a runtime assertion in the factory, because the catalog is
 * statically known here: a missing `plural` should fail at the call site that
 * generates the screens, not on the render that first tries to title a tab.
 *
 * Keeping the key typed is what lets the generated form call `useT('entity')`
 * with a template literal and still fail the build on a typo, instead of
 * reaching for the `useTranslateKey` escape hatch that authored copy must not
 * use. `AccountLabelKey` in `../session/account-links.ts` is the same trick
 * written out by hand; this one cannot drift because it is computed.
 */
export type EntityCatalogKey<
  TEntityCatalog = EntityCatalogOf<TypeOptionsResources>,
> = [TEntityCatalog] extends [never]
  ? // No host augmentation in this compilation — this package's own specs, or
    // an adopter who has not declared one. The factory still works; the key is
    // simply unchecked, which is the same trade `useTranslateKey` makes.
    string
  : {
      [K in keyof TEntityCatalog]: TEntityCatalog[K] extends {
        form: { editTitle: string; newTitle: string };
        label: string;
        plural: string;
      }
        ? K
        : never;
    }[keyof TEntityCatalog] &
      string;

/**
 * The host's `entity` namespace, read back out of its own `i18next`
 * augmentation.
 *
 * ⚠️ **The `entity` catalog is the host's, not entifix's.** It names *their*
 * entities — a parameter, an offering, a sales channel — so a framework that
 * shipped one would be shipping an application's product copy. Reading it back
 * through `CustomTypeOptions` keeps the key union computed rather than written
 * out, which is what stops it drifting, while leaving the catalog where it
 * belongs. A host that declares no augmentation gets `string`, and the factory
 * still works with the gate relaxed.
 */
type TypeOptionsResources = CustomTypeOptions extends { resources: infer R }
  ? R
  : never;

type EntityCatalogOf<TResources> = TResources extends { entity: infer E }
  ? E
  : never;

/**
 * A relation the generated form edits with a picker.
 *
 * The target is named here rather than derived, because the common case is a
 * **plain foreign key**: when the target lives in another slice's store a typed
 * `EntityLink` is both an illegal import and a cross-store join, so the member
 * is a bare `string` (`ProductSpecification.brandId` into `catalog-reference`)
 * and its `@accessor()` has no vocabulary for "the target's name". Hence
 * `labelProperty`/`searchProperty` are stated at the call site instead of being
 * left to `describeEntityColumns`' `'name'` default, which happens to be right
 * today and states nothing.
 *
 * `searchProperty` must be `filterable` on the **target** or the service answers
 * `400`; `useEntityLinkSource` throws at render rather than letting that surface
 * as an empty suggestion list.
 */
export interface EntityCrudLink<TAdapters, TEntity extends Entity = Entity> {
  /** The owning entity's accessor name, e.g. `'brandId'`. */
  readonly field: string;
  readonly entityConstructor: EntityConstructor<Entity>;
  /**
   * Which adapter holds the **target's** repository. Often a different service
   * than the record's own: `catalog-reference` is another slice's store, so
   * resolving an id goes through that domain's own read path.
   */
  readonly repository: AdapterKey<TAdapters, Context<EntityRepositoryTag>>;
  /** Defaults to `'name'`. */
  readonly labelProperty?: string;
  /** Defaults to `'name'`. Must be `filterable` on the target. */
  readonly searchProperty?: string;
  /**
   * A restriction on what may be picked **for this record**, ANDed into every
   * quick and browse request — `useEntityLinkSource`'s `baseFiltering`, built
   * from the record being edited rather than fixed at factory time.
   *
   * A record-dependent rule is the case it exists for: a parent picker that
   * must not offer the record itself or anything beneath it. That rule needs
   * more than the record — its descendants are other records — which is why
   * this is a **hook** and not a function of the record: it may load what it
   * needs through the host's own adapters, and answer `undefined` until it has.
   *
   * Called on every render of the single view, under the rules of hooks: once
   * per link, unconditionally, with `undefined` while the record loads and
   * throughout a create. `undefined` back means no restriction. Its members
   * must be `filterable` on the target, or the service answers `400`. It
   * narrows the suggestions and nothing else — the service still has to refuse
   * a value the picker would not have offered.
   */
  readonly useBaseFiltering?: (
    record: TEntity | undefined,
  ) => AnyFilterGroup | undefined;
}

/**
 * A restriction over a picker's target, with the target's type erased — the
 * link names its target only as `EntityConstructor<Entity>`, so a filter typed
 * on the real target would not be assignable. Erased for the reason
 * {@link AnyEntityLinkSourceConfig} is.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFilterGroup = FilterGroup<any>;

/** The keys of `TAdapters` whose value is assignable to `TValue`. */
export type AdapterKey<TAdapters, TValue> = {
  [K in keyof TAdapters]: TAdapters[K] extends TValue ? K : never;
}[keyof TAdapters];

export interface EntityCrudOptions<TAdapters, TEntity extends Entity> {
  /** The domain shell's adapters hook, e.g. `useMarketplaceAdminAdapters`. */
  readonly useAdapters: () => TAdapters;
  /** Route prefix for both pages, e.g. `'/catalog/product-brand'`. */
  readonly basePath: string;
  /**
   * The entity's `entity` catalog key. Asserted against `@entity({ key })` at
   * factory time — the two are the same string by convention
   * (`entity:product-brand.label` mirrors `key: 'product-brand'`), and letting
   * them drift would title a form after a different entity.
   */
  readonly catalogKey: EntityCatalogKey;
  /** Which adapter holds this entity's own repository. */
  readonly repository: AdapterKey<TAdapters, Context<EntityRepositoryTag>>;
  /**
   * Members the form keeps but does not show — `id` always, plus anything a
   * transaction assigns. A hidden member still round-trips: it is dropped from
   * the rendered fields, not from the draft, so `reconstructEntity` carries it
   * back out of the seeded values.
   */
  readonly hiddenFields?: readonly string[];
  /** `<EntityColumn>` overrides for the list, for presentation metadata cannot express. */
  readonly columns?: ReactNode;
  /**
   * Extra controls beside the table's own — an `<EntityTableToolbar>`.
   *
   * Its own option rather than more `columns`, though both end up as
   * `EntityTable` children and the slots are sorted by component identity: a
   * toolbar filed under a columns prop is a name that lies, and the first thing
   * to go here is a link into a wizard, which is not a column by any reading.
   */
  readonly toolbar?: ReactNode;
  /**
   * How many rows the list asks for on its first load. Defaults to
   * `useDataLoading`'s own default.
   *
   * Raised for a vocabulary that should be seen whole: `EntityTable` nests a
   * hierarchy only within the page it was given, so a tree larger than one page
   * shows the children whose parent fell on another page as roots.
   */
  readonly pageSize?: number;
  /** Frozen at factory time — see `use-entity-link-sources.ts`. */
  readonly links?: readonly EntityCrudLink<TAdapters, TEntity>[];
  /**
   * Where the entity's served affordances come from — `GET /api/<entity>/$metadata`.
   *
   * Supplying it is what turns on every served affordance:
   * Save and Delete filtered against the caller's real grants, the declared
   * verbs on the form, the row overflow menu, and the bulk bar. Omitting it
   * keeps the pre-0026 behaviour exactly, which is what every generated catalog
   * rendered before this option existed.
   *
   * A `EntityMetadataSource` rather than a URL because the two hosts reach
   * their service differently — one through the config-driven REST adapters,
   * one through a shell's own same-origin routes.
   */
  readonly metadataSource?: EntityMetadataSource;
  /**
   * Which adapter holds this entity's {@link EntityMetadataSource} — the same
   * source as {@link metadataSource}, resolved from the host's composition
   * instead of built by the caller.
   *
   * Prefer it: a source is a transport, and naming it by key keeps the module
   * that generates the screens free of the adapter that fetches, exactly as
   * {@link repository} already does for records. Supplying both is a build
   * error — two answers to where the document comes from.
   */
  readonly metadata?: AdapterKey<TAdapters, EntityMetadataSource>;
  /**
   * Which adapter runs this entity's `@useCase()` verbs — over REST against
   * the service that serves them, or in-process for records that live in the
   * browser. Resolved from the host's composition, as {@link repository} is.
   *
   * Supplying it lets the generated screens run what the served `$metadata`
   * lists for the caller: a row's menu and a form's buttons run a verb on a
   * record, and the bulk bar runs a `collection` verb over a selection,
   * reporting per row. A verb that resolves reloads what it changed; one that
   * refuses shows its coded message in the screen's error slot rather than as
   * a promise nobody catches.
   */
  readonly useCases?: AdapterKey<TAdapters, EntityUseCaseRunner>;
}

/**
 * Props both hosts pass. A route host passes none — the slug comes from the URL
 * and a save returns to the list; the workspace tab host passes all of them.
 */
export interface EntityCrudSingleViewProps {
  /** Defaults to the `[slug]` route param. */
  readonly slug?: string;
  /** Defaults to navigating back to the list. */
  readonly onSaved?: () => void;
  readonly onDeleted?: () => void;
  /**
   * Where to autosave the edit. Supplying it is the whole opt-in: the form
   * seeds from the persisted draft, writes to it on every edit, and the page
   * clears it once a save or delete commits.
   *
   * A route host omits it and stays ephemeral, which is the rule stated as a
   * missing prop rather than as a flag — there is no value of "absent" that
   * accidentally starts persisting.
   */
  readonly draft?: EntityDraftStore;
}

/**
 * What the factory returns: a **named descriptor**, not four loose components.
 *
 * The identity fields are here so the workspace registry and the nav are derived
 * from a list of these rather than from the hand-written const maps they replace.
 */
export interface EntityCrud<TEntity extends Entity> {
  readonly entityConstructor: EntityConstructor<TEntity>;
  /** `@entity({ key })`, which is also `catalogKey` and the tab address payload. */
  readonly entityKey: EntityCatalogKey;
  /**
   * `@entity({ labelKey })` — how one record is named. A record tab's title.
   *
   * Read off the decorator rather than passed, so the tab strip, the nav and the
   * search results all name the entity from the one place it names itself.
   */
  readonly entityLabelKey: string;
  /** `@entity({ pluralKey })` — how the collection is named. A list tab's title. */
  readonly entityPluralKey: string;
  readonly basePath: string;
  readonly ListPage: () => ReactElement;
  readonly SingleViewPage: (props?: EntityCrudSingleViewProps) => ReactElement;
}

/**
 * A picker's transport with its context tags erased.
 *
 * The factory cannot preserve one type parameter per link — the pages that
 * build these know their adapters, the generated form only forwards them — and
 * `EntityForm.linkSources` is already `Record<string, EntityLinkSource<any>>`
 * for the same reason.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyEntityLinkSourceConfig = EntityLinkSourceConfig<Entity, any>;

/**
 * One picker, resolved: the descriptor computed once at factory time, and the
 * use-cases plus adapter context the page builds per render.
 */
export interface EntityCrudLinkSource {
  readonly field: string;
  readonly descriptor: EntityFieldDescriptor;
  readonly config: AnyEntityLinkSourceConfig;
}
