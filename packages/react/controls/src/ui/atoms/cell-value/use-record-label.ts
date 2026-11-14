'use client';

import {
  type ChildConstructor,
  findMetaEntity,
  recordLabel,
} from '@entifix/core';
import { useCallback } from 'react';

import { useEntityNoun, useT } from '../../../i18n/index.js';
import {
  useReferenceLabels,
  useUnresolvedReference,
} from '../../utils/reference-labels.js';
import { useValueText } from './cell-value.js';

/**
 * What a record is called, in words — the one derivation every surface that
 * names a record reads: a row's checkbox and title, a card's heading, a
 * confirm dialog's object, the typed delete policy, a breadcrumb, a toast
 * ([ADR 0030](../../../../../../../docs/adr/0030-a-reference-names-its-target-through-the-owners-read-port.md)).
 *
 * Core's `recordLabel()` decides **which** member names the record; this puts
 * it into the reader's language: a value as its cell reads it, a reference by
 * its target's name (or the target's noun and short id until that is known),
 * and otherwise the entity's own noun with the record's short id. Never a
 * whole id, except a reference the host registered nothing to read — which is
 * the developer's cue, not the reader's.
 */
export function useRecordLabel(): (
  entityConstructor: ChildConstructor,
  record: object | undefined,
) => string {
  const valueText = useValueText();
  const lookup = useReferenceLabels();
  const unresolved = useUnresolvedReference();
  const t = useT();
  const noun = useEntityNoun();

  return useCallback(
    (entityConstructor, record) => {
      const label = recordLabel(entityConstructor, record);
      if (label.kind === 'value') return valueText(label.value, label.member);
      if (label.kind === 'reference') {
        const state = lookup.label(label.entity, label.id);
        if (state.status === 'named') {
          return valueText(state.label, {
            ...label.member,
            type: typeof state.label === 'string' ? 'string' : 'localized',
          });
        }
        return state.status === 'unregistered'
          ? label.id
          : unresolved(label.entity, label.id);
      }
      const entityNoun = noun(
        findMetaEntity(entityConstructor) ?? { name: entityConstructor.name },
      );
      return label.shortId === undefined
        ? entityNoun
        : t('reference.unresolved', { noun: entityNoun, id: label.shortId });
    },
    [lookup, noun, t, unresolved, valueText],
  );
}
