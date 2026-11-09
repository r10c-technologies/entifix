'use client';

import { parseChord, type ParsedChord } from '@entifix/core';
import { createContext, useContext, useEffect, useRef } from 'react';

/**
 * Where a set of shortcuts applies: the page, or one workspace tab. A tab's
 * shortcuts fire only while it is the active tab, so two tabs each holding a
 * form can both bind Mod+S without one saving the other.
 */
export interface HotkeyScope {
  readonly id: string;
  readonly active: boolean;
}

/** The page: every shortcut outside a workspace tab. */
export const PAGE_SCOPE: HotkeyScope = { id: 'page', active: true };

const HotkeyScopeContext = createContext<HotkeyScope>(PAGE_SCOPE);

/**
 * Scopes the shortcuts bound below it — a workspace tab passes its own id and
 * whether it is the active tab.
 */
export const HotkeyScopeProvider = HotkeyScopeContext.Provider;

/**
 * Which chords each scope holds, for refusing a second binding of one. A
 * chord is held at most once per scope — a second binding is refused or
 * yields — so a set is enough.
 */
const bound = new Map<string, Set<string>>();

const holds = (scope: string, chord: string): boolean =>
  bound.get(scope)?.has(chord) === true;

/**
 * Whether `chord` is taken where `scope` would bind it: in the same scope, or
 * — since the page's shortcuts apply inside every tab — between the page and
 * a tab.
 */
function isTaken(scope: string, chord: string): boolean {
  if (holds(scope, chord)) return true;
  if (scope === PAGE_SCOPE.id)
    return [...bound.values()].some(chords => chords.has(chord));
  return holds(PAGE_SCOPE.id, chord);
}

function bind(scope: string, chord: string): () => void {
  const chords = bound.get(scope) ?? new Set<string>();
  bound.set(scope, chords.add(chord));
  return () => {
    chords.delete(chord);
  };
}

/** For specs: a page with nothing bound. */
export const resetHotkeysForTesting = (): void => bound.clear();

const matches = (event: KeyboardEvent, chord: ParsedChord): boolean =>
  event.key.toLowerCase() === chord.key &&
  // ⌘ and Ctrl are the same intent on different platforms, so either one
  // satisfies `Mod` rather than each caller sniffing the platform.
  (event.metaKey || event.ctrlKey) &&
  event.shiftKey === chord.shift &&
  event.altKey === chord.alt;

export interface HotkeyOptions {
  /**
   * Bind only if the chord is free, and stay silent if it is not. Without it
   * a second binding of a chord in one scope throws at registration: two
   * handlers for one keystroke is a bug, and whichever fired first would
   * decide what the reader got. A built-in default — a form's Mod+S — takes
   * this, so a host's own binding wins.
   */
  readonly ifFree?: boolean;
  /** Bound only while true; a disabled control's shortcut does nothing. */
  readonly enabled?: boolean;
}

/**
 * Runs `handler` on any of `chords` — `"Mod+K"`, `"Mod+Shift+P"` — within
 * the nearest {@link HotkeyScope} (ADR 0026).
 *
 * - **Modifier chords only**: every one holds `Mod`, so no single key or
 *   Shift+key steals a character from a reader typing (WCAG 2.1.4), and no
 *   Alt+letter, which macOS Option composes into a character. The editing
 *   chords — Mod+A, C, V, X, Y, Z — stay the field's. Anything else throws
 *   when it is bound.
 * - **They fire inside a text field**: a chord is never typing, and Mod+S
 *   is exactly what a reader presses with the caret in a field.
 * - **A chord is held once per scope**, so a conflict is refused when it is
 *   bound rather than resolved by whoever listens first.
 *
 * It calls `preventDefault`, which stops the browser's own action for the
 * chord where the browser lets it; no binding should be the only way to do
 * anything, so a visible control always does the same thing.
 */
export function useHotkey(
  chords: readonly string[],
  handler: (event: KeyboardEvent) => void,
  { ifFree = false, enabled = true }: HotkeyOptions = {},
): void {
  const scope = useContext(HotkeyScopeContext);
  const handlerRef = useRef(handler);
  const activeRef = useRef(scope.active);
  useEffect(() => {
    handlerRef.current = handler;
    activeRef.current = scope.active;
  });

  // Joined rather than passed by identity: callers write the list inline.
  const signature = chords.join(' ');

  useEffect(() => {
    if (!enabled || signature === '') return;
    const parsed = signature.split(' ').map(parseChord);
    const free = parsed.filter(chord => !isTaken(scope.id, chord.text));
    if (free.length < parsed.length && !ifFree) {
      const taken = parsed.find(chord => !free.includes(chord)) as ParsedChord;
      throw new Error(
        `${taken.text} is already bound here. A chord does one thing in a scope: unbind the other, or pass \`ifFree\` to the default that should yield.`,
      );
    }
    if (free.length === 0) return;
    const unbind = free.map(chord => bind(scope.id, chord.text));

    const onKeyDown = (event: KeyboardEvent) => {
      if (!activeRef.current) return;
      if (!free.some(chord => matches(event, chord))) return;
      event.preventDefault();
      handlerRef.current(event);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      for (const release of unbind) release();
    };
  }, [signature, scope.id, ifFree, enabled]);
}
