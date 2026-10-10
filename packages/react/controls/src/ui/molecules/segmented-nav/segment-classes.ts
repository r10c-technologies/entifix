/**
 * The segmented look, shared by `SegmentedNav` (links) and `SegmentedControl`
 * (a choice in the page): one bordered track, the chosen segment filled.
 */
/** The joined segments; scrolls sideways rather than wrapping. */
export const LIST =
  'm-0 flex w-max max-w-full list-none overflow-x-auto rounded-md border border-border p-[0.1875rem] [scrollbar-width:none]';

const SEGMENT =
  'block rounded-[calc(var(--radius-md,0.375rem)-0.125rem)] px-xs py-[0.3125rem] text-step-sm whitespace-nowrap no-underline transition-colors duration-(--duration-fast,150ms) motion-reduce:transition-none';

export const OTHER = `${SEGMENT} focus-ring text-content hover:bg-[color-mix(in_srgb,var(--color-content)_6%,transparent)] hover:text-primary`;

export const CURRENT = `${SEGMENT} bg-primary font-medium text-primary-content`;
