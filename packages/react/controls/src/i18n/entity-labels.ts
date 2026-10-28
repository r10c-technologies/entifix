'use client';

import {
  type EntityFieldDescriptor,
  isFailure,
  problemOf,
} from '@entifix/core';
import { useCallback, useMemo } from 'react';

import { useTranslateKey } from './i18n-context.js';

/**
 * Resolves each descriptor's `labelKey` against the active catalog, leaving the
 * declared `label` in place for members that have no key yet.
 *
 * Done here rather than in `describeEntityColumns` because the same descriptors
 * are the server-side filter allowlist, where a translated label would be
 * meaningless — and because `@entifix/core` (T1) cannot reach
 * `@entifix/i18n` (T2).
 */
export function useLocalizedDescriptors<
  TDescriptor extends EntityFieldDescriptor,
>(descriptors: readonly TDescriptor[]): TDescriptor[] {
  const translate = useTranslateKey();

  return useMemo(
    () =>
      descriptors.map(descriptor =>
        descriptor.labelKey === undefined
          ? descriptor
          : { ...descriptor, label: translate(descriptor.labelKey) },
      ),
    [descriptors, translate],
  );
}

/**
 * Reads one value of an enum member. Falls back to the raw value when the
 * member declared no vocabulary prefix, which is what a `status` of `active`
 * used to render as everywhere.
 */
export function useEnumLabel(): (
  descriptor: EntityFieldDescriptor,
  value: string,
) => string {
  const translate = useTranslateKey();

  return useCallback(
    (descriptor, value) =>
      descriptor.enumLabelKey === undefined
        ? value
        : translate(`${descriptor.enumLabelKey}.${value}`),
    [translate],
  );
}

const ENVELOPE: ReadonlySet<string> = new Set([
  'type',
  'title',
  'status',
  'code',
  'category',
  'detail',
  'instance',
  'traceId',
]);

/**
 * A failure's own fields — `slug` on a `DuplicateSlug`, `entity` on a
 * `NotFound` — as a catalog sentence interpolates them: what its problem body
 * carries beside the envelope. Anything that is not a typed failure has none.
 */
export const failureFields = (failure: unknown): Record<string, unknown> =>
  isFailure(failure)
    ? Object.fromEntries(
        Object.entries(problemOf(failure)).filter(
          ([key]) => !ENVELOPE.has(key),
        ),
      )
    : {};

/** {@link failureFields}, memoised on the failure. */
export function useFailureFields(failure: unknown): Record<string, unknown> {
  return useMemo(() => failureFields(failure), [failure]);
}

/**
 * Renders a failed request in the reader's language.
 *
 * A typed failure carries its `code` on itself
 * ([ADR 0013](../../../../../docs/adr/0013-failures-are-typed-values-decided-at-the-shell.md)),
 * and its own fields are handed to the sentence, so `errors:duplicateSlug`
 * can say which slug. An error from a service that still answers
 * `{ error, code, detail }` carries its code on `details`. Falling back to
 * `message` keeps a failure that predates the vocabulary — or one raised
 * client-side — readable rather than blank.
 */
export function useErrorMessage(): (error: {
  message: string;
  code?: unknown;
  details?: Record<string, unknown>;
}) => string {
  const translate = useTranslateKey();

  return useCallback(
    error => {
      const code =
        typeof error.code === 'string' ? error.code : error.details?.['code'];
      return typeof code === 'string'
        ? translate(`errors:${code}`, failureFields(error))
        : error.message;
    },
    [translate],
  );
}
