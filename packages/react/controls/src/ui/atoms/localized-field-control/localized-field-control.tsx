'use client';

import {
  type EntityFieldDescriptor,
  type EntityLocalizedDraft,
  locales,
} from '@entifix/core';

import { TextInput } from '../field/index.js';

export interface LocalizedFieldControlProps {
  descriptor: EntityFieldDescriptor;
  /** The draft: one text per locale. A locale with no entry renders empty. */
  value: EntityLocalizedDraft;
  onChange: (value: EntityLocalizedDraft) => void;
  /** The first input's id, so the row's `<label for>` lands on it. */
  id?: string;
  'aria-invalid'?: boolean;
}

/**
 * The editor for a `localized` member: one text input per locale the host
 * declared, in declaration order, each marked with its locale code.
 *
 * Every locale is always on screen. A translation is part of the record, not an
 * afterthought behind a switcher, and an input left empty is exactly what the
 * form's completeness rule will point at.
 *
 * Its own atom rather than a branch of `FieldControl`, because its value is a
 * map and not a string: `FieldControl` is the string-draft control, and keeping
 * it so keeps every other member's contract unchanged.
 */
export function LocalizedFieldControl({
  descriptor,
  value,
  onChange,
  id,
  'aria-invalid': invalid,
}: LocalizedFieldControlProps) {
  return (
    <div className="flex flex-col gap-3xs">
      {locales().map((locale, index) => (
        <div key={locale} className="flex items-center gap-2xs">
          <span
            aria-hidden
            className="w-8 shrink-0 text-step-sm text-content-muted uppercase"
          >
            {locale}
          </span>
          <TextInput
            id={index === 0 ? id : id && `${id}-${locale}`}
            aria-label={`${descriptor.label} (${locale})`}
            aria-invalid={invalid}
            lang={locale}
            value={value[locale] ?? ''}
            disabled={descriptor.readonly}
            onChange={event =>
              onChange({ ...value, [locale]: event.currentTarget.value })
            }
          />
        </div>
      ))}
    </div>
  );
}
