'use client';

import type { ScaledFormat } from '@entifix/core';
import { useCallback } from 'react';

import { useTranslateKey } from '../../../i18n/index.js';

/** A unit in the reader's words, or its code when the host declared none. */
export function useUnitLabel(): (
  scaled: ScaledFormat,
  unit: string | undefined,
) => string | undefined {
  const translate = useTranslateKey();
  return useCallback(
    (scaled, unit) =>
      unit === undefined || scaled.unitLabelKey === undefined
        ? unit
        : translate(`${scaled.unitLabelKey}.${unit}`),
    [translate],
  );
}
