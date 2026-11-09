'use client';

import { isCategory } from '@entifix/core';
import type { ReactNode } from 'react';

import { useErrorMessage, useT } from '../../../i18n/index.js';
import { Alert } from '../../atoms/alert/index.js';
import { Button } from '../../atoms/button/index.js';
import { EmptyState } from '../empty-state/index.js';

/** A failure as the organisms hold it: a typed failure, or anything thrown. */
export interface RegionStateError {
  message: string;
  code?: unknown;
  details?: Record<string, unknown>;
}

export interface RegionStateProps {
  /** What the region holds, plural — "invoices" — for the state's sentence. */
  plural: string;
  /** The first load: the organism's skeleton speaks for it, so nothing here. */
  isLoading?: boolean;
  /** A load that failed. */
  error?: RegionStateError;
  /** Loads the region again. Without it, an error offers no Retry. */
  onRetry?: () => void;
  /** The load answered, with nothing in it. */
  isEmpty?: boolean;
  /** A filter is in effect, so an empty answer is the filter's, not the data's. */
  isFiltered?: boolean;
  /** Clears every filter — what an empty filtered region offers. */
  onClearFilters?: () => void;
  /** What an empty, unfiltered region offers: creating the first record. */
  emptyAction?: ReactNode;
  /** Data from before the failure is still on screen. */
  hasStaleData?: boolean;
}

/**
 * What a region says when it is not simply showing its content
 * ([ADR 0028](../../../../../../../docs/adr/0028-states-an-organism-must-render.md)):
 *
 * - a **load error** is an `Alert` with Retry — `forbidden` says so in its own
 *   words — and data kept from before it is marked possibly out of date;
 * - an **empty result under a filter** says so and offers Clear filters;
 * - an **empty region** says what appears here, and offers its first record.
 *
 * It renders nothing while loading, and nothing when there is content: the
 * organism's own skeleton and rows speak then. An empty result and a dead
 * backend never look alike.
 */
export function RegionState({
  plural,
  isLoading = false,
  error,
  onRetry,
  isEmpty = false,
  isFiltered = false,
  onClearFilters,
  emptyAction,
  hasStaleData = false,
}: RegionStateProps) {
  const t = useT();
  const errorMessage = useErrorMessage();
  // Read inside a sentence, so as a common noun: "sus facturas".
  const noun = plural.toLocaleLowerCase();

  if (error !== undefined) {
    return (
      <Alert
        tone="danger"
        data-testid="region-state-error"
        action={
          onRetry === undefined ? undefined : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onRetry}
            >
              {t('state.retry')}
            </Button>
          )
        }
      >
        {isCategory('forbidden')(error)
          ? t('state.forbidden', { plural: noun })
          : errorMessage(error)}
        {hasStaleData && ` ${t('state.stale')}`}
      </Alert>
    );
  }

  if (isLoading || !isEmpty) return null;

  if (isFiltered) {
    return (
      <EmptyState
        action={
          onClearFilters === undefined ? undefined : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onClearFilters}
            >
              {t('state.clearFilters')}
            </Button>
          )
        }
      >
        {t('state.noResults', { plural: noun })}
      </EmptyState>
    );
  }

  return (
    <EmptyState action={emptyAction}>
      {t('state.empty', { plural: noun })}
    </EmptyState>
  );
}
