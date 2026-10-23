import type { EntityRowDraft } from './EntityRowDraft.js';

/**
 * A form's in-progress values, keyed by accessor name.
 *
 * A scalar member's value is a **string**, because that is what a native input
 * round-trips: a `scalarCollection` drafts as a comma list, a `date` as
 * `yyyy-mm-dd`, a relation as its foreign key. Reading one is therefore still
 * `values[name] ?? ''` in every place that only edits scalars.
 *
 * A **`composition`** member's value is an `EntityRowDraft[]` — rows the master
 * owns, each a string map carrying its own `ROW_KEY`. That is the whole reason
 * this is a union and not `string`: rows have no lossless string form, and the
 * two shapes a draft can hold are exactly the two composition metadata names.
 *
 * A **`localized`** member's value is an {@link EntityLocalizedDraft}, a text per
 * locale.
 *
 * **Exactly three shapes, and the union says so rather than `JsonValue`.** Both
 * are JSON — a workspace autosaves a draft through `createJSONStorage`,
 * so a class instance, an `EntityLink` or a `Date` does not degrade, it returns
 * as something else, silently — but `JsonValue` would say more than is true. A
 * member whose value is neither a string nor a row list has no editor, no
 * coercion and no restore rule: `reconstructEntity` would carry it through
 * untouched and the serializer would write it.
 *
 * The narrower union is also what keeps the form engine compiling. `JsonValue`
 * is **recursive**, and TanStack Form derives a field-path type from the value
 * it is given, so a draft typed that way makes that derivation unbounded —
 * `Type instantiation is excessively deep and possibly infinite`. A row is a
 * flat string map, so this union has a bottom and the derivation terminates.
 *
 * The alias exists in **one** place on purpose. The same structural type was
 * declared four times — `EntityFormValues`, `EntityFormDraft`, `EntityLinkDraft`
 * and `EntityCrudDraft` — and collapsing them is what made this widening a
 * single edit rather than four found by search.
 */
export type EntityDraftValue =
  string | readonly EntityRowDraft[] | EntityLocalizedDraft;

/**
 * A `localized` member's draft: one string per locale, the text each input
 * holds. Flat like a row, so the union still has a bottom for TanStack Form to
 * derive paths from, and JSON-safe for the same autosave a row has to survive.
 * Told apart from a row list by not being an array.
 */
export type EntityLocalizedDraft = Readonly<Record<string, string>>;

export type EntityDraft = Record<string, EntityDraftValue>;

/**
 * The string a draft holds for a scalar member.
 *
 * A draft value is `JsonValue` now, but every scalar editor still writes and
 * reads a string, so this is the read every one of them performs — in one
 * place, so a member that came back from storage as a number or `null` renders
 * as an empty input instead of flipping React from controlled to uncontrolled
 * mid-render.
 */
export function readDraftString(
  values: EntityDraft | undefined,
  name: string,
): string {
  const value = values?.[name];
  return typeof value === 'string' ? value : '';
}

/**
 * The per-locale texts a draft holds for a `localized` member, or an empty map
 * for anything else — a member never seeded, or one that came back from
 * storage in another shape.
 */
export function readLocalizedDraft(
  values: EntityDraft | undefined,
  name: string,
): EntityLocalizedDraft {
  const value = values?.[name];
  if (
    value === undefined ||
    typeof value === 'string' ||
    Array.isArray(value)
  ) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as EntityLocalizedDraft).filter(
      ([, text]) => typeof text === 'string',
    ),
  );
}
