/**
 * A declared chord as `aria-keyshortcuts` writes it: `Mod` is ⌘ on macOS and
 * Ctrl elsewhere, and the attribute cannot know which machine it is read on, so
 * it names both — `Mod+S` is `Control+S Meta+S`. A chord with no `Mod` is
 * written once.
 */
export function ariaKeyShortcuts(chord: string): string {
  if (!chord.split('+').includes('Mod')) return chord;
  const as = (modifier: string) =>
    chord
      .split('+')
      .map(part => (part === 'Mod' ? modifier : part))
      .join('+');
  return `${as('Control')} ${as('Meta')}`;
}

/**
 * A declared chord as a person reads it on their own machine: `⌘S` on a Mac,
 * `Ctrl+S` elsewhere — what the command palette shows beside an action.
 */
export function shortcutLabel(
  chord: string,
  mac = /Mac|iPhone|iPad/.test(navigator.platform),
): string {
  return chord
    .split('+')
    .map(part => (part === 'Mod' ? (mac ? '⌘' : 'Ctrl') : part))
    .join(mac ? '' : '+');
}
