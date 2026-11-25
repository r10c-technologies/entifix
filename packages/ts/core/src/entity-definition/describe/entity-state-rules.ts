import { UnavailableInState } from '../../failure/generic.js';
import type { Entity, EntityConstructor } from '../../types/Entity.js';
import { extractMetaAccessors, extractMetaEntity } from '../helpers/index.js';
import type { UseCaseAvailability } from '../meta-entities/meta-use-case/index.js';
import { isUseCaseAvailable } from './describe-entity-use-cases.js';

/**
 * The states a record must hold for a person to save it or delete it, as
 * `@entity()` declared them — the shape `$metadata` serves beside the
 * entity's actions and a form reads
 * ([ADR 0029](../../../../../../docs/adr/0029-a-verb-declares-the-states-it-is-legal-from.md)).
 * Every member is absent on an entity that declares none.
 */
export interface EntityStateRules {
  writableWhen?: UseCaseAvailability;
  deletableWhen?: UseCaseAvailability;
  /** Catalog key for the line a read-only form shows at its top. */
  readOnlyReasonKey?: string;
}

/** An entity's {@link EntityStateRules}, read from its `@entity()`. */
export function describeEntityStateRules<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
): EntityStateRules {
  const { writableWhen, deletableWhen, readOnlyReasonKey } =
    extractMetaEntity(entityConstructor);
  return {
    ...(writableWhen === undefined ? {} : { writableWhen }),
    ...(deletableWhen === undefined ? {} : { deletableWhen }),
    ...(readOnlyReasonKey === undefined ? {} : { readOnlyReasonKey }),
  };
}

/**
 * Whether a person may save `record`: always, without a `writableWhen`;
 * otherwise once the record has arrived and holds one of its states. A record
 * still in flight is not writable yet, rather than editable for a moment.
 *
 * A record being created has no state to hold — a surface asks this only of a
 * stored one.
 */
export function isRecordWritable(
  rules: EntityStateRules | undefined,
  record: object | undefined,
): boolean {
  return isUseCaseAvailable({ availableWhen: rules?.writableWhen }, record);
}

/** Whether a person may delete `record`, by the rule of {@link isRecordWritable}. */
export function isRecordDeletable(
  rules: EntityStateRules | undefined,
  record: object | undefined,
): boolean {
  return isUseCaseAvailable({ availableWhen: rules?.deletableWhen }, record);
}

/**
 * A state condition as a store writes it: the member's stored key —
 * `alias ?? name`, the column or field the record is persisted under — and the
 * states it must hold. What an adapter conjoins onto its conditional write.
 */
export interface StoredStateCondition {
  /** The member's own name, as `UnavailableInState` reports it. */
  readonly member: string;
  /** The stored key: `alias ?? name`. */
  readonly key: string;
  readonly in: readonly string[];
}

/**
 * Resolves a declared condition to the key the store holds it under. Throws on
 * a member the entity lacks — the declaration was checked at load, so this is
 * a caller passing another entity's condition.
 */
export function storedStateCondition(
  entityConstructor: EntityConstructor<Entity>,
  condition: UseCaseAvailability,
): StoredStateCondition {
  const member = extractMetaAccessors(entityConstructor).find(
    accessor => accessor.name === condition.member,
  );
  if (member === undefined) {
    throw new Error(
      `${entityConstructor.name} has no member "${condition.member}" to condition a write on.`,
    );
  }
  return {
    member: condition.member,
    key: String(member.alias ?? member.name),
    in: condition.in,
  };
}

/**
 * The refusal a store answers when a conditional write found the record in
 * another state: `stored` is what the store read back after the write matched
 * nothing — the write already decided, the read only names the refusal.
 */
export function unavailableInState(
  entityConstructor: EntityConstructor<Entity>,
  condition: StoredStateCondition,
  stored: unknown,
): UnavailableInState {
  const state = (
    stored as Readonly<Record<string, unknown>> | null | undefined
  )?.[condition.key];
  return new UnavailableInState({
    entity: extractMetaEntity(entityConstructor).key ?? entityConstructor.name,
    member: condition.member,
    ...(typeof state === 'string' ? { state } : {}),
    allowed: [...condition.in],
  });
}

/** Whether a stored document or row holds one of `condition`'s states. */
export function holdsStoredState(
  condition: StoredStateCondition,
  stored: unknown,
): boolean {
  const state = (
    stored as Readonly<Record<string, unknown>> | null | undefined
  )?.[condition.key];
  return typeof state === 'string' && condition.in.includes(state);
}
