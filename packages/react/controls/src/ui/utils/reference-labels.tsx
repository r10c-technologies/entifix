'use client';

import { localize, type LocalizedText, shortId } from '@entifix/core';
import { createContext, type ReactNode, useCallback, useContext } from 'react';

import {
  type EntityNounSource,
  useEntityNoun,
  useLocale,
  useT,
} from '../../i18n/index.js';

/**
 * Where the name of one referenced record stands
 * ([ADR 0030](../../../../../../docs/adr/0030-a-reference-names-its-target-through-the-owners-read-port.md)):
 *
 * - `resolving` — asked for and not here yet;
 * - `named` — read, as a text or a text per locale;
 * - `notFound` — read, and no record answered the id (deleted, or one the
 *   reader may not read);
 * - `failed` — the read itself failed;
 * - `unregistered` — the host registered nothing that reads this entity.
 */
export type ReferenceLabelState =
  | { readonly status: 'resolving' }
  | { readonly status: 'named'; readonly label: string | LocalizedText }
  | { readonly status: 'notFound' }
  | { readonly status: 'failed' }
  | { readonly status: 'unregistered' };

/**
 * How the controls ask what a referenced record is called. A host fills it —
 * batching what a render asks for into one read per target entity — and the
 * controls only read it, so this package imports neither TanStack nor the
 * integration layer.
 */
export interface ReferenceLabelLookup {
  /** The name of the record of `entityKey` (`domain:key`) whose id is `id`. */
  label(entityKey: string, id: string): ReferenceLabelState;
  /** How to call the entity itself, when a record's name could not be read. */
  noun?(entityKey: string): EntityNounSource | undefined;
}

const UNREGISTERED: ReferenceLabelState = { status: 'unregistered' };

const ReferenceLabelsContext = createContext<ReferenceLabelLookup>({
  label: () => UNREGISTERED,
});

/**
 * Publishes a host's reference lookup to every control that renders a
 * reference — a cell, a card, a read form, a confirm dialog. Without one, a
 * reference reads as its raw id, muted, which is what tells a developer the
 * registry is missing.
 */
export function ReferenceLabelsProvider({
  lookup,
  children,
}: {
  lookup: ReferenceLabelLookup;
  children: ReactNode;
}) {
  return (
    <ReferenceLabelsContext.Provider value={lookup}>
      {children}
    </ReferenceLabelsContext.Provider>
  );
}

/** The nearest {@link ReferenceLabelsProvider}'s lookup. */
export const useReferenceLabels = (): ReferenceLabelLookup =>
  useContext(ReferenceLabelsContext);

/** Where one referenced record's name stands. */
export function useReferenceLabel(
  entityKey: string,
  id: string,
): ReferenceLabelState {
  return useReferenceLabels().label(entityKey, id);
}

/** `catalog:product-offering` → `product-offering`: the entity's key, when it has no noun. */
const keyOf = (entityKey: string) =>
  entityKey.slice(entityKey.indexOf(':') + 1);

/**
 * Words for a referenced record that has no name to show — its entity's noun
 * and the id's short form ("Offering product-…"), so the reader still has
 * something to quote. Never the whole id.
 */
export function useUnresolvedReference(): (
  entityKey: string,
  id: string,
) => string {
  const t = useT();
  const noun = useEntityNoun();
  const lookup = useReferenceLabels();
  return useCallback(
    (entityKey, id) => {
      const source = lookup.noun?.(entityKey);
      return t('reference.unresolved', {
        noun: source === undefined ? keyOf(entityKey) : noun(source),
        id: shortId(id),
      });
    },
    [lookup, noun, t],
  );
}

/**
 * One referenced record as plain words — its name when read, otherwise the
 * noun and short id, or the raw id when nothing is registered to read it. For
 * the places that need text rather than an element: an accessible name, a
 * button's label.
 */
export function useReferenceText(entityKey: string, id: string): string {
  const state = useReferenceLabel(entityKey, id);
  const unresolved = useUnresolvedReference();
  const locale = useLocale();
  switch (state.status) {
    case 'named':
      return typeof state.label === 'string'
        ? state.label
        : (localize(state.label, locale) ?? id);
    case 'unregistered':
      return id;
    default:
      return unresolved(entityKey, id);
  }
}
