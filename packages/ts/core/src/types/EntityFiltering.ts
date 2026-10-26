import type { Entity } from './Entity.js';

export const EntityFilterBinaryOperators = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
] as const;
export type EntityFilterBinaryOperator =
  (typeof EntityFilterBinaryOperators)[number];
export type EntityFilterBinary<
  TEntity extends Entity,
  TKey extends keyof TEntity,
> = {
  property: TKey;
  operator: EntityFilterBinaryOperator;
  value: TEntity[TKey];
};

export const EntityFilterArrayOperators = ['in', 'nin'] as const;
export type EntityFilterArrayOperator =
  (typeof EntityFilterArrayOperators)[number];
export type EntityFilterArray<
  TEntity extends Entity,
  TKey extends keyof TEntity,
> = {
  property: TKey;
  operator: EntityFilterArrayOperator;
  values: Array<TEntity[TKey]>;
};

export const EntityFilterRangeOperators = ['between', 'nbetween'] as const;
export type EntityFilterRangeOperator =
  (typeof EntityFilterRangeOperators)[number];
export type EntityFilterRange<
  TEntity extends Entity,
  TKey extends keyof TEntity,
> = {
  property: TKey;
  operator: EntityFilterRangeOperator;
  start: TEntity[TKey];
  end: TEntity[TKey];
};

export const EntityFilterStringOperators = ['like', 'nlike'] as const;
export type EntityFilterStringOperator =
  (typeof EntityFilterStringOperators)[number];
export type EntityFilterString<TEntity extends Entity> = {
  property: keyof TEntity;
  operator: EntityFilterStringOperator;
  value: string;
};

export const EntityFilterNullOperators = ['isNull', 'isNotNull'] as const;
export type EntityFilterNullOperator =
  (typeof EntityFilterNullOperators)[number];
export type EntityFilterNull<
  TEntity extends Entity,
  TKey extends keyof TEntity,
> = {
  property: TKey;
  operator: EntityFilterNullOperator;
};

/**
 * One step into a member that holds an array of records: `items.vendorId` on
 * an order whose `items` are `OrderItem[]`. One level only, which is all a
 * filter on an embedded line needs.
 *
 * ⚠️ **Server-authored filters only.** A client's request is parsed against
 * the entity's own `filterable` members, and a path is not one, so a browser
 * still cannot name `items.vendorId`. This type exists so the server code that
 * narrows a read — a scope conjoined onto a load request — can say what it
 * means without a cast.
 */
export type EntityMemberPath<TEntity> = {
  [K in keyof TEntity & string]: NonNullable<
    TEntity[K]
  > extends readonly (infer E)[]
    ? E extends object
      ? `${K}.${keyof E & string}`
      : never
    : never;
}[keyof TEntity & string];

/** The type a value at an {@link EntityMemberPath} holds. */
export type EntityMemberPathValue<TEntity, TPath> =
  TPath extends `${infer K}.${infer M}`
    ? K extends keyof TEntity
      ? NonNullable<TEntity[K]> extends readonly (infer E)[]
        ? M extends keyof E
          ? E[M]
          : never
        : never
      : never
    : never;

/**
 * A filter on an {@link EntityMemberPath}. It matches a record when **any**
 * element of the array satisfies it, and a negated operator (`ne`, `nin`,
 * `nbetween`, `nlike`, `isNull`) when **no** element satisfies its positive
 * form — the semantics Mongo applies to a dotted path into an array.
 */
export type EntityPathFilter<TEntity extends Entity> = {
  [P in EntityMemberPath<TEntity>]:
    | {
        property: P;
        operator: EntityFilterBinaryOperator;
        value: EntityMemberPathValue<TEntity, P>;
      }
    | {
        property: P;
        operator: EntityFilterArrayOperator;
        values: Array<EntityMemberPathValue<TEntity, P>>;
      }
    | {
        property: P;
        operator: EntityFilterRangeOperator;
        start: EntityMemberPathValue<TEntity, P>;
        end: EntityMemberPathValue<TEntity, P>;
      }
    | { property: P; operator: EntityFilterStringOperator; value: string }
    | { property: P; operator: EntityFilterNullOperator };
}[EntityMemberPath<TEntity>];

export type EntityFilter<TEntity extends Entity> =
  | EntityFilterBinary<TEntity, keyof TEntity>
  | EntityFilterArray<TEntity, keyof TEntity>
  | EntityFilterRange<TEntity, keyof TEntity>
  | EntityFilterString<TEntity>
  | EntityFilterNull<TEntity, keyof TEntity>
  | EntityPathFilter<TEntity>;

export const LogicOperators = ['and', 'or'] as const;
export type LogicOperator = (typeof LogicOperators)[number];
export type FilterGroup<TEntity extends Entity> = {
  operator: LogicOperator;
  values: Array<EntityFilter<TEntity> | FilterGroup<TEntity>>;
};

export type EntityFiltering<TEntity extends Entity> =
  EntityFilter<TEntity> | Array<EntityFilter<TEntity>> | FilterGroup<TEntity>;
