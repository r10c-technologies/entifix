import { Schema } from 'effect';

import {
  type FailureCategory,
  type FailureClass,
  type FailureFacts,
  familyOf,
  RESERVED_FIELDS,
} from './failure.js';
import { failureTypeUri, registerFailure } from './registry.js';

export interface FailureOptions<Fields> {
  /**
   * The failure's `message`, from its fields — what a terminal shows when it is
   * thrown and what a problem body carries as `detail`. Written for a reader:
   * never a stack, never `String(error)`.
   */
  readonly message?: (fields: Fields) => string;
}

/**
 * The definer for one category.
 *
 * ```ts
 * class DuplicateSlug extends Failure.conflict<DuplicateSlug>()(
 *   'DuplicateSlug',
 *   'duplicateSlug',
 *   { slug: Schema.String },
 * ) {}
 * ```
 *
 * The curried `<Self>()` is `Schema.TaggedError`'s own shape, kept because the
 * class has to name itself for its instances to type as itself. `code`,
 * `category` and `family` ride on the prototype — they are facts about the
 * class, not fields an instance is constructed with — and enter the instance
 * type through `TaggedError`'s brand parameter, as literals, so a predicate on
 * them narrows a union.
 *
 * The code is registered here, at definition. A second tag claiming it throws
 * before anything runs.
 *
 * ⚠️ The registry holds the class this returns, not the subclass that extends
 * it, so a failure decoded from a wire is an instance of the base. That is why
 * a failure class carries fields and no behaviour — a `message` written as a
 * getter on the subclass would vanish on decode, so it is passed here and put
 * on the base — and why nothing matches a failure with `instanceof`.
 */
export const defineFailure =
  <C extends FailureCategory>(category: C) =>
  <Self = never>() =>
  <
    const Tag extends string,
    const Code extends string,
    const Fields extends Schema.Struct.Fields = Record<never, never>,
  >(
    tag: Tag,
    code: Code,
    fields?: Fields,
    options: FailureOptions<Schema.Struct.Type<Fields>> = {},
  ) => {
    const own = fields ?? ({} as Fields);
    const shadowed = Object.keys(own).filter(key => RESERVED_FIELDS.has(key));
    if (shadowed.length > 0)
      throw new Error(
        `failure '${tag}' declares ${shadowed.map(key => `'${key}'`).join(', ')}, ` +
          'which the problem body reserves for itself. Rename the field.',
      );

    const Base = Schema.TaggedError<Self, FailureFacts<Code, C>>()(tag, own);
    // `Base` is still `TaggedError`'s conditional type here — `Self` resolves
    // only at the `extends` site — so the prototype is reached through a cast.
    Object.defineProperties(
      (Base as unknown as { prototype: object }).prototype,
      {
        code: { value: code, enumerable: false },
        category: { value: category, enumerable: false },
        family: { value: familyOf(category), enumerable: false },
        ...(options.message === undefined
          ? {}
          : {
              message: {
                get(this: Schema.Struct.Type<Fields>) {
                  return options.message?.(this);
                },
                enumerable: false,
              },
            }),
      },
    );

    registerFailure({
      code,
      tag,
      category,
      family: familyOf(category),
      type: failureTypeUri(code),
      failureClass: Base as unknown as FailureClass,
    });

    return Base;
  };
