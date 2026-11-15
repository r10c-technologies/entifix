import {
  describeEntityColumns,
  type Entity,
  type EntityConstructor,
  type EntityFieldDescriptor,
  type EntityLoadRequest,
  entityReferenceKey,
  envelopeEntityName,
  findMetaEntity,
  type Locale,
  localizedQueryProperty,
  queryPropertyFor,
  readEntityPageEnvelope,
  recordLabel,
  serializeLoadRequestParams,
  shortId,
} from '@entifix/core';
import { Effect, Exit } from 'effect';

import type { RecordSearchOption } from './record-search.types.js';

/**
 * What a host declares in order to make one entity searchable from the palette.
 *
 * The search and label members are **declared**, not derived, and that is not an
 * oversight in the metadata: `linkSearchProperty`/`linkLabelProperty` are
 * properties of a *referring* accessor — they say how the owner of a relation
 * looks up its target — and an entity has no member that says "this is what I am
 * called". So the host that mounts the screens says it, next to the route those
 * screens live at.
 */
export interface RecordSearchSourceConfig<TEntity extends Entity> {
  /** Stable id, unique per host. Defaults to the entity's wire name. */
  readonly key?: string;
  readonly entityConstructor: EntityConstructor<TEntity>;
  /** Where the owning service listens, **without** the `/api` suffix. */
  readonly baseUrl: string;
  /**
   * The `filterable` member a term is matched against: a string or localized
   * member, matched with `like` — or, with {@link reference}, the member that
   * holds the referenced record's id, matched with `=in=`.
   */
  readonly searchProperty: string;
  /**
   * The `sortable` member read as a record's label. Omitted, the record names
   * itself as every other surface names it — its `labelMember`, else the
   * first member that can name it — and one nothing names is sent `unnamed`,
   * by its short id; the group is then sorted by {@link searchProperty}, which
   * must be `sortable`. Never given with {@link reference}, which labels.
   */
  readonly labelProperty?: string;
  /** An optional secondary line — a code, a role. */
  readonly sublabelProperty?: string;
  /** The group heading, as the entity's own `pluralKey`. */
  readonly labelKey: string;
  /** Where selecting a record lands. Locale-free; the caller prefixes it. */
  readonly href: (id: string) => string;
  /**
   * Search through the record {@link searchProperty} refers to, when that is
   * what a person knows the record by: a stock item by its product's name.
   * The term is matched against the referenced entity's label at its owner,
   * and the records referring to the matches are read and labelled with
   * their names.
   */
  readonly reference?: RecordSearchReference;
}

/** The entity a source is searched through, and where its owner listens. */
export interface RecordSearchReference {
  // Any entity: the target is another domain's class, typed by nothing here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly entityConstructor: EntityConstructor<any>;
  /** Where the target's owning service listens, **without** the `/api` suffix. */
  readonly baseUrl: string;
  /**
   * The target member the term is matched against and the records are
   * labelled by — a filterable, sortable string or localized member. Defaults
   * to the target's declared `labelMember`.
   */
  readonly labelProperty?: string;
}

/** One referenced record a term matched: its id, and what it is called. */
export interface RecordSearchMatch {
  readonly id: string;
  readonly label: string;
}

/** A declared source, reduced to what the fan-out actually calls. */
export interface RecordSearchSource {
  readonly key: string;
  readonly entity: string;
  readonly labelKey: string;
  /**
   * The upstream URL for one term, in the reader's locale — which a localized
   * search or label member is filtered and sorted in.
   */
  readonly url: (term: string, limit: number, locale: Locale) => string;
  /**
   * `undefined` when the body is not a readable `entityPage` envelope. A
   * localized label reads in `locale`. Given `names`, a record is labelled by
   * the name of the record it refers to, and the items come in their order.
   */
  readonly read: (
    body: unknown,
    locale: Locale,
    names?: ReadonlyMap<string, string>,
  ) => { items: RecordSearchOption[]; total: number } | undefined;
  /**
   * Present for a source searched through a reference: the target's URL for
   * one term, its matches, and this source's URL for the records referring to
   * them. When it is, {@link url} is never called.
   */
  readonly through?: {
    readonly url: (term: string, limit: number, locale: Locale) => string;
    readonly read: (
      body: unknown,
      locale: Locale,
    ) => readonly RecordSearchMatch[] | undefined;
    readonly urlFor: (ids: readonly string[], limit: number) => string;
  };
}

const descriptorOf = (
  columns: EntityFieldDescriptor[],
  name: string,
): EntityFieldDescriptor | undefined =>
  columns.find(column => column.name === name);

const rejection = (
  entityName: string,
  member: string,
  because: string,
  fix: string,
): Error =>
  new Error(`Cannot search ${entityName} by "${member}": ${because} ${fix}`);

/**
 * Where a record falls among the matches it refers to: in their order, and
 * after them when it refers to none of them — never ahead of a named one.
 */
const rankOf = (order: readonly string[] | undefined, id: string): number => {
  if (order === undefined) return 0;
  const at = order.indexOf(id);
  return at === -1 ? order.length : at;
};

const isText = (descriptor: EntityFieldDescriptor) =>
  descriptor.type === 'string' || descriptor.type === 'localized';

/**
 * Built through `serializeLoadRequestParams`, never by hand. That is
 * correctness rather than tidiness: `encodeRsqlValue` quotes a term carrying
 * any of `;,()'"=!<>\` or whitespace, so `Acme, Inc.` stays one value instead
 * of splitting the expression into two comparisons.
 */
const pageUrl = (
  baseUrl: string,
  entity: string,
  filter:
    | { property: string; operator: 'like'; value: string }
    | { property: string; operator: 'in'; values: readonly string[] },
  sortBy: string | undefined,
  limit: number,
): string => {
  const request = {
    filtering: [filter],
    ...(sortBy === undefined
      ? {}
      : { sorting: [{ 0: { property: sortBy, type: 'asc' as const } }] }),
    page: 1,
    pageSize: limit,
  } as unknown as EntityLoadRequest;
  return `${baseUrl}/api/${entity}?${serializeLoadRequestParams(request).toString()}`;
};

/** The target's label member, checked the way a source's own label is. */
const throughLabel = (
  entityName: string,
  search: EntityFieldDescriptor,
  reference: RecordSearchReference,
): EntityFieldDescriptor => {
  const target = reference.entityConstructor;
  const referenced = entityReferenceKey(target);
  if (search.references?.entity !== referenced) {
    throw rejection(
      entityName,
      search.name,
      `the member does not reference ${referenced}, so its value is no ${target.name} id.`,
      `Declare \`references: { entity: '${referenced}' }\` on it, or search through the entity it does reference.`,
    );
  }
  const name =
    reference.labelProperty ?? findMetaEntity(target)?.labelMember ?? undefined;
  const label =
    name === undefined
      ? undefined
      : descriptorOf(describeEntityColumns(target), name);
  if (
    label === undefined ||
    !label.filterable ||
    !label.sortable ||
    !isText(label)
  ) {
    throw rejection(
      entityName,
      search.name,
      `${target.name} is not named by a filterable, sortable text member${name === undefined ? '' : ` ("${name}" is not one)`}, so a term cannot be matched against it.`,
      "Name one as the reference's `labelProperty`, or declare the target's `labelMember`.",
    );
  }
  return label;
};

/**
 * Declare a record search source, validating it against the entity's own
 * metadata **now** rather than on the first keystroke.
 *
 * Every check here guards a failure that is otherwise silent at both ends: the
 * service answers `400`, and a caller renders that as a group it could not
 * reach — which reads as "there are no products". `assertSearchable` took the
 * same posture for the relation picker, for the same reason.
 *
 * ⚠️ This throws at **module load**, so a bad declaration fails the whole app at
 * boot rather than just search. That is deliberate — a source silently missing
 * from a palette is indistinguishable from a permission the caller lacks — but
 * the blast radius is wider than the picker's, which fails only its own render.
 */
export const defineRecordSearchSource = <TEntity extends Entity>({
  key,
  entityConstructor,
  baseUrl,
  searchProperty,
  labelProperty,
  sublabelProperty,
  labelKey,
  href,
  reference,
}: RecordSearchSourceConfig<TEntity>): RecordSearchSource => {
  const entity = envelopeEntityName(entityConstructor);
  const entityName = entityConstructor.name;
  const columns = describeEntityColumns(entityConstructor);

  const search = descriptorOf(columns, searchProperty);
  if (search === undefined) {
    throw rejection(
      entityName,
      searchProperty,
      'the entity declares no such member.',
      'Name a member the entity actually has.',
    );
  }
  // `filterable` is simultaneously the server-side RSQL allowlist.
  if (!search.filterable) {
    throw rejection(
      entityName,
      searchProperty,
      'the member is not filterable, so the service would reject the query.',
      'Declare it `filterable` on the entity, or search another member.',
    );
  }

  const through =
    reference === undefined
      ? undefined
      : throughLabel(entityName, search, reference);

  // A `like` against anything else reaches `coerceValue`, which rejects a
  // partial term — so an enum member reads as declarable and is permanently
  // broken: every keystroke short of a whole value answers `400`. A localized
  // member is text too, searched in the reader's locale. A member searched
  // through a reference is matched by `=in=`, so it holds an id instead.
  if (through === undefined && !isText(search)) {
    throw rejection(
      entityName,
      searchProperty,
      `the member is a ${search.type}, and a partial term is not a valid value for it.`,
      'Search a string or localized member instead.',
    );
  }

  if (through !== undefined && labelProperty !== undefined) {
    throw rejection(
      entityName,
      labelProperty,
      'a source searched through a reference is labelled by the records it refers to.',
      'Drop `labelProperty`, or the reference.',
    );
  }

  const label =
    labelProperty === undefined
      ? undefined
      : descriptorOf(columns, labelProperty);
  if (labelProperty !== undefined) {
    if (label === undefined) {
      throw rejection(
        entityName,
        labelProperty,
        'the entity declares no such label member.',
        'Name a member the entity actually has.',
      );
    }
    // The group is sorted by the label, so the flag is load-bearing: without
    // it the service rejects the sort and the group degrades whole. Unsorted
    // was the alternative and is worse — the services apply no default order,
    // so results would arrive in storage order and shuffle as records are
    // rewritten. A localized label sorts in the reader's locale.
    if (!label.sortable) {
      throw rejection(
        entityName,
        labelProperty,
        'the label member is not sortable, so the service would reject the sort.',
        'Declare it `sortable` on the entity, or label records by another member.',
      );
    }
  } else if (through === undefined && !search.sortable) {
    // A record that names itself has no one member to sort by, so the group
    // is sorted by what the term matched — for the same reason as above.
    throw rejection(
      entityName,
      searchProperty,
      'with no label member the group is sorted by the search member, and it is not sortable.',
      'Declare it `sortable`, or name a `labelProperty`.',
    );
  }

  let sublabel: EntityFieldDescriptor | undefined;
  if (sublabelProperty !== undefined) {
    sublabel = descriptorOf(columns, sublabelProperty);
    if (sublabel === undefined) {
      throw rejection(
        entityName,
        sublabelProperty,
        'the entity declares no such sublabel member.',
        'Name a member the entity actually has, or drop `sublabelProperty`.',
      );
    }
  }

  /**
   * What a record is called when no member was declared to label it: what
   * every other surface calls it, read in the reader's locale — or, when
   * nothing names it, its short id, sent `unnamed` for the caller to put the
   * entity's noun to. A reference is not resolved here: the record is named
   * by its own id rather than by an id that points elsewhere.
   */
  const ownLabel = (
    row: Record<string, unknown>,
    id: string,
    locale: Locale,
  ): Pick<RecordSearchOption, 'label' | 'unnamed'> => {
    const named = recordLabel(entityConstructor, row);
    const text =
      named.kind === 'value'
        ? localizedQueryProperty(named.member, locale).read(named.value)
        : undefined;
    return text === undefined
      ? { label: shortId(id), unnamed: true }
      : { label: text };
  };

  const labelOf = (
    row: Record<string, unknown>,
    id: string,
    locale: Locale,
  ): Pick<RecordSearchOption, 'label' | 'unnamed'> => {
    if (label === undefined) return ownLabel(row, id, locale);
    const raw = localizedQueryProperty(label, locale).read(row[label.name]);
    // A blank label is as useless as a missing one, so both fall back to the
    // id — an unnamed record must stay distinguishable from the one above it.
    // Same rule the relation picker's `labelOf` applies.
    return { label: raw === undefined || raw === '' ? id : raw };
  };

  const read = (
    body: unknown,
    locale: Locale,
    names?: ReadonlyMap<string, string>,
  ): { items: RecordSearchOption[]; total: number } | undefined => {
    const page = Effect.runSyncExit(
      readEntityPageEnvelope(entityConstructor, body),
    );
    if (Exit.isFailure(page)) return undefined;

    const order = names === undefined ? undefined : [...names.keys()];
    const items = page.value.items
      .filter(record => (record as Entity).id != null)
      .map(record => {
        const row = record as unknown as Record<string, unknown>;
        const id = String((record as Entity).id);
        const sublabelText =
          sublabel === undefined
            ? undefined
            : localizedQueryProperty(sublabel, locale).read(row[sublabel.name]);
        const named =
          names === undefined
            ? labelOf(row, id, locale)
            : { label: names.get(String(row[searchProperty])) ?? shortId(id) };
        return {
          id,
          ...named,
          ...(sublabelText === undefined ? {} : { sublabel: sublabelText }),
          entity,
          href: href(id),
          rank: rankOf(order, String(row[searchProperty])),
        };
      })
      // In the order the referenced records matched, which is their names'.
      .sort((left, right) => left.rank - right.rank)
      .map(({ rank: _rank, ...option }) => option satisfies RecordSearchOption);

    return { items, total: page.value.total };
  };

  const sortBy = (locale: Locale) =>
    label === undefined
      ? queryPropertyFor(search, locale)
      : queryPropertyFor(label, locale);

  return {
    key: key ?? entity,
    entity,
    labelKey,
    url: (term, limit, locale) =>
      pageUrl(
        baseUrl,
        entity,
        {
          property: queryPropertyFor(search, locale),
          operator: 'like',
          value: term,
        },
        sortBy(locale),
        limit,
      ),
    read,
    ...(through === undefined || reference === undefined
      ? {}
      : {
          through: throughOf(reference, through, (ids, limit) =>
            pageUrl(
              baseUrl,
              entity,
              { property: search.key, operator: 'in', values: ids },
              // The order is the matches', applied by `read`.
              undefined,
              limit,
            ),
          ),
        }),
  };
};

/** The target half of a source searched through a reference. */
const throughOf = (
  reference: RecordSearchReference,
  label: EntityFieldDescriptor,
  urlFor: (ids: readonly string[], limit: number) => string,
): NonNullable<RecordSearchSource['through']> => {
  const target = reference.entityConstructor;
  const targetEntity = envelopeEntityName(target);
  return {
    url: (term, limit, locale) =>
      pageUrl(
        reference.baseUrl,
        targetEntity,
        {
          property: queryPropertyFor(label, locale),
          operator: 'like',
          value: term,
        },
        queryPropertyFor(label, locale),
        limit,
      ),
    read: (body, locale) => {
      const page = Effect.runSyncExit(readEntityPageEnvelope(target, body));
      if (Exit.isFailure(page)) return undefined;
      return page.value.items
        .filter(record => (record as Entity).id != null)
        .map(record => {
          const id = String((record as Entity).id);
          const name = localizedQueryProperty(label, locale).read(
            (record as unknown as Record<string, unknown>)[label.name],
          );
          return {
            id,
            label: name === undefined || name === '' ? shortId(id) : name,
          };
        });
    },
    urlFor,
  };
};
