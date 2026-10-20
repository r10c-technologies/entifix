import type { EntityDraftMessages } from '@entifix/react-integration';

/** A translate function bound to the `controls` namespace. */
export type ControlsTranslate = (
  key: string,
  params?: Record<string, unknown>,
) => string;

/**
 * The form's validation sentences, in the `controls` catalog's words.
 *
 * The integration package owns the validation *rules* and this shell owns the
 * sentences, because a sideways import between the two T3 packages is an edge
 * the tier register does not declare. `count` doubles as i18next's plural
 * selector, so `minItems` reads "1 item" and "2 items".
 */
export function validationMessagesFor(
  ct: ControlsTranslate,
): EntityDraftMessages {
  const say =
    (failure: 'required' | 'number' | 'date' | 'option') => (field: string) =>
      ct(`validation.${failure}`, { field });
  return {
    required: say('required'),
    number: say('number'),
    date: say('date'),
    option: say('option'),
    minItems: (field, count) => ct('validation.minItems', { field, count }),
    maxItems: (field, count) => ct('validation.maxItems', { field, count }),
    notBefore: (field, other) => ct('validation.notBefore', { field, other }),
  };
}
