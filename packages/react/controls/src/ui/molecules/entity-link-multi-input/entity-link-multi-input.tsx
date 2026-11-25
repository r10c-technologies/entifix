'use client';

import type {
  Entity,
  EntityFieldDescriptor,
  EntityLinkSource,
} from '@entifix/core';

import { useT } from '../../../i18n/index.js';
import { ReferenceValue } from '../../atoms/cell-value/cell-value.js';
import { useReferenceText } from '../../utils/reference-labels.js';
import { EntityLinkInput } from '../entity-link-input/index.js';

export interface EntityLinkMultiInputProps<TTarget extends Entity> {
  /**
   * The `scalarCollection` being edited. It declares `references`, which is
   * how each held id is named.
   */
  descriptor: EntityFieldDescriptor;
  /** The held ids as the draft carries a list: comma-separated, `''` for none. */
  value: string;
  source: EntityLinkSource<TTarget>;
  /** The new comma list, after an id was added or removed. */
  onChange: (next: string) => void;
  /** The id the field's label points at — the input that adds one more. */
  id?: string;
  disabled?: boolean;
}

/** The draft's comma list as ids, blanks dropped. */
export const readIdList = (value: string): string[] =>
  value
    .split(',')
    .map(item => item.trim())
    .filter(item => item !== '');

function HeldReference({
  entity,
  id,
  disabled,
  onRemove,
}: {
  entity: string;
  id: string;
  disabled: boolean;
  onRemove: () => void;
}) {
  const t = useT();
  const text = useReferenceText(entity, id);
  return (
    <li className="flex min-h-(--target-min) items-center gap-3xs rounded-md border border-border bg-surface-elevated ps-2xs text-step-sm text-content">
      <ReferenceValue entity={entity} id={id} />
      {!disabled && (
        <button
          type="button"
          aria-label={t('link.remove', { item: text })}
          onClick={onRemove}
          className="flex min-h-(--target-min) min-w-(--target-min) items-center justify-center rounded-md text-content-muted focus-ring hover:text-content"
        >
          <svg aria-hidden viewBox="0 0 20 20" className="size-4 fill-current">
            <path d="M6 4.6 10 8.6l4-4 1.4 1.4-4 4 4 4-1.4 1.4-4-4-4 4L4.6 14l4-4-4-4z" />
          </svg>
        </button>
      )}
    </li>
  );
}

/**
 * The editor for a list of references — a `scalarCollection` that declares
 * `references`, each element one target's id. What is held is a list of names,
 * each with its own remove button; one more is added through the same quick
 * search and browse dialog a single reference uses, so a picker that holds
 * many is the picker that holds one, said twice.
 *
 * It writes the comma list the draft carries for every `scalarCollection`, so
 * validation, reconstruction and every adapter see the ids exactly as before.
 * An id already held is never offered again, and not added twice. An id no record answers still shows
 * — as the noun and a short id — and can still be removed.
 */
export function EntityLinkMultiInput<TTarget extends Entity>({
  descriptor,
  value,
  source,
  onChange,
  id,
  disabled = false,
}: EntityLinkMultiInputProps<TTarget>) {
  const t = useT();
  const held = readIdList(value);
  const entity = descriptor.references?.entity ?? '';

  const add = (target: TTarget) => {
    if (target.id == null) return;
    // A held id is never offered, so whatever arrives here is new.
    onChange([...held, String(target.id)].join(','));
  };

  const remove = (index: number) =>
    onChange(held.filter((_, at) => at !== index).join(','));

  return (
    <div className="flex flex-col gap-3xs">
      {held.length === 0 ? (
        <span
          data-testid={`entity-link-value-${descriptor.name}`}
          className="text-step-sm text-content-muted"
        >
          {t('link.none')}
        </span>
      ) : (
        <ul
          aria-label={descriptor.label}
          data-testid={`entity-link-value-${descriptor.name}`}
          className="flex flex-wrap gap-3xs"
        >
          {held.map((heldId, index) => (
            <HeldReference
              key={heldId}
              entity={entity}
              id={heldId}
              disabled={disabled}
              onRemove={() => remove(index)}
            />
          ))}
        </ul>
      )}
      {!disabled && (
        <EntityLinkInput<TTarget>
          descriptor={descriptor}
          value=""
          source={source}
          id={id}
          adding
          exclude={held}
          onSelect={add}
        />
      )}
    </div>
  );
}
