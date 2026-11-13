import type { Schema } from 'effect';

import type { FailureClass } from '../../../failure/failure.js';
import type { Entity, EntityConstructor } from '../../../types/Entity.js';

/** What a use case acts on: one record, a selection, or nothing. */
export type UseCaseBinding = 'entity' | 'collection' | 'unbound';

/**
 * Where a surface puts the action. Deliberately **not** derivable from
 * {@link UseCaseBinding}: an entity-bound action can be determining (a footer
 * "Publish" that finalizes the page) or context-independent (a toolbar action
 * available whenever a record is open). Collapsing the two would force every
 * surface to re-derive a placement the author already knew.
 */
export type UseCasePlacement =
  'context-dependent' | 'context-independent' | 'determining';

/**
 * One place a verb can appear: a binding and a placement together.
 *
 * The pair is the unit rather than either half, because the two answer
 * different questions — placement decides the *surface* and binding decides the
 * *payload* — and a verb reachable from a row and from a selection differs in
 * both at once.
 */
export interface UseCaseCell {
  binding: UseCaseBinding;
  placement: UseCasePlacement;
}

/** Confirmation a surface must obtain before running the use case. */
export interface UseCaseConfirm {
  tone: 'destructive' | 'neutral';
  /** Catalog key. Copy never lives in a descriptor. */
  messageKey: string;
  /**
   * Catalog key for the confirming button. Absent, the button repeats the
   * verb's own label: a dialog that says "Confirm" makes the reader go back to
   * the title to learn what they are agreeing to.
   */
  confirmLabelKey?: string;
  /**
   * Catalog key for what an `undo` verb's toast says once it has run, in the
   * past tense — "Invoice voided." Absent, a generic sentence names the verb.
   */
  doneKey?: string;
}

/**
 * How a destructive verb is made safe
 * ([ADR 0026](../../../../../../../docs/adr/0026-actions-hierarchy-overflow-and-destructive-verbs.md)):
 * - `undo` acts at once and offers Undo, which runs the verb's `inverse`;
 * - `confirm` asks first, in a dialog that names what will be destroyed;
 * - `typed` asks the reader to type the record's name, or the count, first.
 *
 * Required on every `confirm.tone: 'destructive'` verb, and refused at
 * declaration without it: a destructive verb whose safety is left to whichever
 * surface renders it is one click on one of them.
 */
export type UseCaseReversible = 'undo' | 'confirm' | 'typed';

/**
 * The states a record must be in for a verb to apply to it: the record's
 * `member` — an `enumValues` accessor, by its own name as the record holds
 * it rather than any wire alias — holds one of `in`.
 *
 * ⚠️ **This is presentation, not authorization.** A surface hides a verb the
 * record's state does not allow, so a shipment awaiting dispatch offers
 * Dispatch and nothing that only a dispatched one can take. The verb's handler
 * still refuses an illegal move — a record can change between the render and
 * the click, and a selection carries no states at all — so a bulk run reports
 * such a row as a failed outcome rather than skipping it on the client.
 *
 * Declared beside the verb rather than derived from a transition table because
 * the framework has no notion of one; a host that keeps a table derives `in`
 * from it, so the states are written once.
 */
export interface UseCaseAvailability {
  member: string;
  in: readonly string[];
}

/**
 * How much weight a surface gives a verb. One `primary` per surface — the
 * thing the surface is for — and every other verb `default`; a second primary
 * on one surface throws when it renders
 * ([ADR 0026](../../../../../../../docs/adr/0026-actions-hierarchy-overflow-and-destructive-verbs.md)).
 */
export type UseCaseEmphasis = 'primary' | 'default';

/**
 * The hierarchy a surface renders a verb in: its weight, its order among the
 * secondaries, whether a row shows it inline, and the chord that reaches it.
 */
export interface UseCaseHierarchy {
  emphasis?: UseCaseEmphasis;
  /**
   * Order among the surface's secondaries, lowest first; equal or absent keeps
   * declaration order. The first three stay visible and the rest fold into
   * "More actions".
   */
  priority?: number;
  /**
   * Shown on the row itself rather than only in its menu — at most one verb
   * per entity, since a row with two inline buttons is a toolbar per row.
   */
  rowInline?: true;
  /**
   * A modifier chord, `Mod+Shift+P`: `Mod` is ⌘ on macOS and Ctrl elsewhere.
   * Rendered as `aria-keyshortcuts` and listed in the command palette.
   */
  shortcut?: string;
}

/**
 * What `@useCase()` declares.
 *
 * `entity` is the target the verb is registered against — it is what the
 * decorator appends to, and it is not part of the served descriptor.
 *
 * `labelKey` is mandatory and namespace-qualified, the `GuardedNavItem`
 * convention: i18n is mandatory and `react/jsx-no-literals` fails the build on a
 * string written into JSX, so a descriptor carrying copy could not be rendered.
 *
 * `keywordsKey` is a catalog key rather than a `string[]` so the command palette
 * matches across locales — a user typing an English term reaches a Spanish
 * command.
 */
export interface MetaUseCaseOptions<
  TKey extends string,
  TEntity extends Entity,
> extends UseCaseHierarchy {
  entity: EntityConstructor<TEntity>;
  key: TKey;
  binding: UseCaseBinding;
  placement: UseCasePlacement;
  /**
   * Further places the same verb appears, beyond the {@link binding} and
   * {@link placement} above.
   *
   * ⚠️ **One verb, one permission, several surfaces.** Publishing an offering
   * from its form, from a row menu and over a selection is one act reached three
   * ways, and the alternative was three `@useCase()` classes — which `slices`
   * refuses anyway, since a verb key is the third segment of one permission and
   * two classes cannot share a key. Three classes would have meant three
   * permissions for one act, and a grant that let somebody publish one offering
   * but not twenty.
   *
   * The primary cell stays where it is so that nothing already declared
   * changes, and so a descriptor still reads as "this verb lives here" with the
   * rest as additions.
   */
  alsoAt?: readonly UseCaseCell[];
  labelKey: string;
  keywordsKey?: string;
  confirm?: UseCaseConfirm;
  /** How a destructive verb is made safe. Required when `confirm.tone` is `destructive`. */
  reversible?: UseCaseReversible;
  /** The verb Undo runs, by key. Required with `reversible: 'undo'`. */
  inverse?: string;
  /**
   * The states a record must be in for the verb to be offered on it — see
   * {@link UseCaseAvailability}. Refused on an `unbound` verb, which has no
   * record to be in a state.
   */
  availableWhen?: UseCaseAvailability;
  /** Names a form a surface should open instead of acting immediately. */
  form?: string;
  /**
   * The use case whose variants this verb resolves between, by name: the
   * service holds the rules, and `$metadata` reports which one this caller
   * resolves to.
   */
  variants?: string;
  /** The recipe this verb starts a flow from, by name — the flow-backed verbs. */
  recipe?: string;
  /**
   * What the verb's endpoint takes, answers and refuses with — the contract
   * the shell derives the endpoint from. Absent `payload` means the verb takes
   * no body; absent `success` means its answer is not described. None of the
   * three reaches a served `$metadata` document.
   */
  payload?: Schema.Top;
  success?: Schema.Top;
  errors?: readonly FailureClass[];
}

/**
 * What the use-case class's **own** metadata carries, as opposed to what is
 * appended to the entity. Two fields are enough to derive the permission, which
 * is what lets `permissionForUseCase(SomeUC)` take a single argument and keeps
 * the verb string written exactly once.
 */
export interface MetaUseCaseBinding {
  entity: EntityConstructor<Entity>;
  key: string;
  /**
   * Which of the entity's verbs under `key` the class is: one key may be
   * declared on a record and over a selection, and each class is one of them.
   */
  binding: UseCaseBinding;
}

export class MetaUseCase {
  //#region Properties
  readonly entity: EntityConstructor<Entity>;
  readonly key: string;
  readonly binding: UseCaseBinding;
  readonly placement: UseCasePlacement;
  readonly alsoAt?: readonly UseCaseCell[];
  readonly labelKey: string;
  readonly keywordsKey?: string;
  readonly confirm?: UseCaseConfirm;
  readonly reversible?: UseCaseReversible;
  readonly inverse?: string;
  readonly availableWhen?: UseCaseAvailability;
  readonly emphasis?: UseCaseEmphasis;
  readonly priority?: number;
  readonly rowInline?: true;
  readonly shortcut?: string;
  readonly form?: string;
  readonly variants?: string;
  readonly recipe?: string;
  readonly payload?: Schema.Top;
  readonly success?: Schema.Top;
  readonly errors?: readonly FailureClass[];
  //#endregion

  //#region Constructors
  constructor(options: MetaUseCaseOptions<string, Entity>) {
    this.entity = options.entity;
    this.key = options.key;
    this.binding = options.binding;
    this.placement = options.placement;
    this.alsoAt = options.alsoAt;
    this.labelKey = options.labelKey;
    this.keywordsKey = options.keywordsKey;
    this.confirm = options.confirm;
    this.reversible = options.reversible;
    this.inverse = options.inverse;
    this.availableWhen = options.availableWhen;
    this.emphasis = options.emphasis;
    this.priority = options.priority;
    this.rowInline = options.rowInline;
    this.shortcut = options.shortcut;
    this.form = options.form;
    this.variants = options.variants;
    this.recipe = options.recipe;
    this.payload = options.payload;
    this.success = options.success;
    this.errors = options.errors;
  }
  //#endregion

  //#region Methods
  //#endregion

  //#region Accessors
  //#endregion
}
