import { Entity, EntityConstructor } from '../../types/Entity.js';
import { extractMetaUseCases } from '../helpers/index.js';
import type {
  UseCaseAvailability,
  UseCaseBinding,
  UseCaseCell,
  UseCaseConfirm,
  UseCaseHierarchy,
  UseCasePlacement,
  UseCaseReversible,
} from '../meta-entities/meta-use-case/index.js';

/**
 * An action a caller may take on an entity, resolved from its use-case
 * metadata. The counterpart to {@link EntityFieldDescriptor}, and like it,
 * framework-free and copy-free — every human-readable member is a catalog key.
 *
 * It carries no `entity`: this is the shape that goes over the wire from
 * `GET /api/<entity>/$metadata`, where the entity is already the address.
 */
export interface UseCaseDescriptor extends UseCaseHierarchy {
  /** The verb. Also the third segment of the permission guarding it. */
  key: string;
  binding: UseCaseBinding;
  placement: UseCasePlacement;
  /** Further cells this same verb appears in — see `MetaUseCaseOptions`. */
  alsoAt?: readonly UseCaseCell[];
  labelKey: string;
  keywordsKey?: string;
  confirm?: UseCaseConfirm;
  /** How a destructive verb is made safe — see `UseCaseReversible`. */
  reversible?: UseCaseReversible;
  /** The verb Undo runs, by key. */
  inverse?: string;
  /** The states a record must be in for the verb to be offered on it. */
  availableWhen?: UseCaseAvailability;
  form?: string;
  /** The named variant set this verb resolves between. */
  variants?: string;
  /** The named recipe this verb starts a flow from. */
  recipe?: string;
  /**
   * What this verb resolves to **for the caller asking** — present only on a
   * served `$metadata` document, computed per principal.
   */
  composition?: UseCaseComposition;
}

/** Which variant, and which flow, a verb resolves to for one caller. */
export interface UseCaseComposition {
  useCase: string;
  variant: string;
  recipe?: string;
  slipVersion?: number;
  /** The `id@n` references the recipe can pin, in order. */
  fragments?: readonly string[];
}

/**
 * Resolves the use cases declared against an entity, in declaration order.
 *
 * Unlike {@link describeEntityColumns}, this is only trustworthy where the
 * use-case modules have been loaded: a `@useCase()` class registers itself when
 * its module evaluates. On a service that is the composition root's job, and
 * a host's register should fail the build on a class its package barrel does
 * not export.
 * A browser never calls this — it fetches the descriptors instead, so no
 * use-case implementation reaches a client bundle.
 */
export function describeEntityUseCases<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
): UseCaseDescriptor[] {
  return extractMetaUseCases(entityConstructor).map(metaUseCase => ({
    key: metaUseCase.key,
    binding: metaUseCase.binding,
    placement: metaUseCase.placement,
    alsoAt: metaUseCase.alsoAt,
    labelKey: metaUseCase.labelKey,
    keywordsKey: metaUseCase.keywordsKey,
    confirm: metaUseCase.confirm,
    reversible: metaUseCase.reversible,
    inverse: metaUseCase.inverse,
    availableWhen: metaUseCase.availableWhen,
    emphasis: metaUseCase.emphasis,
    priority: metaUseCase.priority,
    rowInline: metaUseCase.rowInline,
    shortcut: metaUseCase.shortcut,
    form: metaUseCase.form,
    variants: metaUseCase.variants,
    recipe: metaUseCase.recipe,
  }));
}

/**
 * Whether a surface offers `descriptor` on `record`: always, for a verb that
 * declares no {@link UseCaseAvailability}; otherwise only once the record has
 * arrived and its member holds one of the declared states. A record still in
 * flight offers none of its state-bound verbs, rather than all of them for a
 * moment.
 *
 * Presentation only — the verb's handler is what refuses an illegal move.
 */
export function isUseCaseAvailable(
  descriptor: Pick<UseCaseDescriptor, 'availableWhen'>,
  record: object | undefined,
): boolean {
  const availability = descriptor.availableWhen;
  if (availability === undefined) return true;
  if (record === undefined) return false;
  const state = (record as Readonly<Record<string, unknown>>)[
    availability.member
  ];
  return typeof state === 'string' && availability.in.includes(state);
}
