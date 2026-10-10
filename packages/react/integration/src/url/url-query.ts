import type {
  Entity,
  EntityFilter,
  EntityFiltering,
  EntityLoadRequest,
  EntitySorting,
  FilterGroup,
} from '@entifix/core';

/**
 * Any entity, as far as a parameter can tell: it names its property by text,
 * since a dotted path (`title.en`) is no key of the entity's type.
 */
type AnyEntity = Entity & Record<string, unknown>;

/** What one parameter of the query string turns into. */
export type Condition = EntityFilter<AnyEntity> | FilterGroup<AnyEntity>;

/**
 * One parameter a query string may carry: the values it accepts and the
 * condition they become. `allowed` drops anything else, so a hand-edited or
 * stale link filters on what still exists; `single` keeps the first value
 * only, as a search box has one.
 */
export interface FilterParam<TContext> {
  readonly allowed?: readonly string[];
  readonly single?: boolean;
  readonly condition: (
    values: readonly string[],
    context: TContext,
  ) => Condition;
}

/**
 * A parameter that orders rather than filters: each value it accepts names a
 * sorting (`?sort=date-desc`). It holds one value, and any other is dropped.
 */
export interface SortParam {
  readonly sorting: Readonly<Record<string, EntitySorting<AnyEntity>[]>>;
}

/**
 * A parameter that picks one record to show rather than filters or orders
 * the answer: `?adr=0016`. It holds one value, `allowed` when given, and never
 * reaches the request.
 */
export interface SelectParam {
  readonly select: true;
  readonly allowed?: readonly string[];
}

export type UrlParam<TContext> =
  FilterParam<TContext> | SortParam | SelectParam;

/** Whether a parameter orders the answer rather than filters it. */
function isSortParam<TContext>(param: UrlParam<TContext>): param is SortParam {
  return 'sorting' in param;
}

/** Whether a parameter picks a record rather than asks the load anything. */
function isSelectParam<TContext>(
  param: UrlParam<TContext>,
): param is SelectParam {
  return 'select' in param;
}

/** The values of every parameter, in the order the URL gave them. */
export type UrlState<TKey extends string> = Readonly<
  Record<TKey, readonly string[]>
>;

export interface UrlQuery<TKey extends string, TContext> {
  /** Every parameter with no value: no filter at all. */
  readonly empty: UrlState<TKey>;
  parse(search: string): UrlState<TKey>;
  /** `''` for an empty state, else `?` and the parameters in declared order. */
  serialize(state: UrlState<TKey>): string;
  isEmpty(state: UrlState<TKey>): boolean;
  /** Whether any parameter that filters has a value; a sort alone does not. */
  isFiltering(state: UrlState<TKey>): boolean;
  /**
   * Whether the state asks the load anything: a filter or a sort. A
   * selection alone does not.
   */
  isAsking(state: UrlState<TKey>): boolean;
  /** The state with every filter emptied, and its sort and selection kept. */
  withoutFilters(state: UrlState<TKey>): UrlState<TKey>;
  /** The load request the state stands for: one condition per parameter set. */
  request<TEntity extends Entity>(
    state: UrlState<TKey>,
    context: TContext,
  ): EntityLoadRequest<TEntity>;
}

export interface UrlQueryOptions<TKey extends string, TContext> {
  readonly params: Readonly<Record<TKey, UrlParam<TContext>>>;
  /** Applied to every request, filtered or not, unless a sort is chosen. */
  readonly sorting?: EntitySorting<AnyEntity>[];
}

/**
 * A filter kept in the query string, read as an entifix `EntityLoadRequest`.
 *
 * entifix's own `parseLoadRequestParams` writes RSQL and accepts only members
 * marked `filterable`, which no collection or localized member may be. This
 * declares its parameters instead: readable URLs (`?tag=a&tag=b&q=text`) whose
 * every value is checked, each becoming one condition of the request.
 */
export function defineUrlQuery<TKey extends string, TContext = undefined>({
  params,
  sorting: defaultSorting,
}: UrlQueryOptions<TKey, TContext>): UrlQuery<TKey, TContext> {
  const keys = Object.keys(params) as TKey[];
  const filterKeys = keys.filter(
    key => !isSortParam(params[key]) && !isSelectParam(params[key]),
  );
  const askingKeys = keys.filter(key => !isSelectParam(params[key]));
  const stateOf = (values: (key: TKey) => readonly string[]) =>
    Object.fromEntries(
      keys.map(key => [key, values(key)]),
    ) as unknown as UrlState<TKey>;
  const empty = stateOf(() => []);

  const accepted = (key: TKey, values: string[]) => {
    const param = params[key];
    const { allowed, single } = isSortParam(param)
      ? { allowed: Object.keys(param.sorting), single: true }
      : isSelectParam(param)
        ? { allowed: param.allowed, single: true }
        : param;
    // Kept as written: a search box being typed into holds its spaces.
    const kept = values
      .filter(value => value.trim() !== '')
      .filter(value => allowed === undefined || allowed.includes(value));
    const unique = [...new Set(kept)];
    return single ? unique.slice(0, 1) : unique;
  };

  return {
    empty,
    parse(search) {
      const query = new URLSearchParams(search);
      return stateOf(key => accepted(key, query.getAll(key)));
    },
    serialize(state) {
      const query = new URLSearchParams();
      for (const key of keys) {
        for (const value of state[key]) query.append(key, value);
      }
      const text = query.toString();
      return text === '' ? '' : `?${text}`;
    },
    isEmpty(state) {
      return keys.every(key => state[key].length === 0);
    },
    isFiltering(state) {
      return filterKeys.some(key => state[key].length > 0);
    },
    isAsking(state) {
      return askingKeys.some(key => state[key].length > 0);
    },
    withoutFilters(state) {
      return stateOf(key => (filterKeys.includes(key) ? [] : state[key]));
    },
    request<TEntity extends Entity>(state: UrlState<TKey>, context: TContext) {
      const filtering = filterKeys.flatMap(key => {
        const param = params[key] as FilterParam<TContext>;
        return state[key].length === 0
          ? []
          : [param.condition(state[key], context)];
      });
      const chosen = keys.flatMap(key => {
        const param = params[key];
        const [value] = state[key];
        return isSortParam(param) && value !== undefined
          ? [param.sorting[value] as EntitySorting<AnyEntity>[]]
          : [];
      });
      const sorting = chosen[0] ?? defaultSorting;
      return {
        ...(filtering.length > 0 && {
          filtering: filtering as unknown as EntityFiltering<TEntity>[],
        }),
        ...(sorting !== undefined && {
          sorting: sorting as unknown as EntitySorting<TEntity>[],
        }),
      };
    },
  };
}

/** Any of the values: `in`, which matches any element of a collection too. */
export function anyOf(property: string) {
  return (values: readonly string[]): Condition => ({
    property,
    operator: 'in',
    values: [...values],
  });
}

/**
 * The text as a substring of a member, as the repository's `like` matches
 * it. `property` names the member for a context, as a locale picks the
 * member holding its text.
 */
export function containing<TContext>(
  property: (context: TContext) => string,
): FilterParam<TContext>['condition'] {
  return ([value], context) => ({
    property: property(context),
    operator: 'like',
    value: (value as string).trim(),
  });
}

/** A date inside any of the given years (UTC), as `between` per year. */
export function inAnyYear(property: string) {
  return (values: readonly string[]): Condition => ({
    operator: 'or',
    values: values.map(year => ({
      property,
      operator: 'between' as const,
      start: new Date(`${year}-01-01T00:00:00.000Z`),
      end: new Date(`${year}-12-31T23:59:59.999Z`),
    })),
  });
}
