/** The four message tones of the token contract (ADR 0025). */
export type Tone = 'danger' | 'warning' | 'success' | 'info';

/**
 * Each tone's text on its own `-subtle` surface: a pair the contract holds to
 * 4.5:1 in every palette, so nothing here needs a contrast of its own.
 */
export const TONE_SURFACE: Record<Tone, string> = {
  danger: 'border-danger bg-danger-subtle text-danger',
  warning: 'border-warning bg-warning-subtle text-warning',
  success: 'border-success bg-success-subtle text-success',
  info: 'border-info bg-info-subtle text-info',
};
