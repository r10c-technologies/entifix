'use client';

import { useState } from 'react';

import { useT } from '../../../i18n/index.js';
import { Button } from '../../atoms/button/index.js';
import { Select } from '../../atoms/field/index.js';
import { Text } from '../../atoms/text/index.js';
import { cn } from '../../utils/cn.js';
import { pageCount } from './page-math.js';

export const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export interface PaginationProps {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  className?: string;
}

/**
 * Page stepper plus an optional page-size selector, driven by callbacks.
 *
 * A `nav` with First, Previous, Next and Last. An end that goes nowhere stays
 * focusable and says so with `aria-disabled`, rather than dropping out of the
 * tab order under the reader's hand. A page change is announced — "Page 2 of
 * 5" — and the first render is not.
 *
 * For a listing whose pages are addresses (server-rendered, crawlable, working
 * without JavaScript) use {@link PaginationLinks} instead.
 */
export function Pagination({
  currentPage,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  className,
}: PaginationProps) {
  const t = useT();
  const totalPages = pageCount(totalItems, pageSize);
  const [announced, setAnnounced] = useState(false);

  const step = (label: string, page: number, enabled: boolean) => (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      // Headless UI runs no handler on an `aria-disabled` button, so an end
      // that goes nowhere is inert while it keeps its place in the tab order.
      aria-disabled={enabled ? undefined : true}
      onClick={() => {
        setAnnounced(true);
        onPageChange(page);
      }}
    >
      {label}
    </Button>
  );

  return (
    <nav
      aria-label={t('pagination.label')}
      className={cn(
        'flex flex-wrap items-center justify-between gap-2xs',
        className,
      )}
    >
      <Text step={-1} tone="muted">
        {t('pagination.summary', {
          current: currentPage,
          total: totalPages,
          items: totalItems,
        })}
      </Text>
      <span role="status" className="sr-only">
        {announced
          ? t('pagination.page', { current: currentPage, total: totalPages })
          : ''}
      </span>

      <div className="flex flex-wrap items-center gap-2xs">
        {onPageSizeChange && (
          <label className="flex items-center gap-3xs text-step-sm text-content-muted">
            {t('pagination.rows')}
            <Select
              value={pageSize}
              onChange={event => onPageSizeChange(Number(event.target.value))}
            >
              {pageSizeOptions.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </label>
        )}
        {step(t('pagination.first'), 1, currentPage > 1)}
        {step(t('pagination.previous'), currentPage - 1, currentPage > 1)}
        {step(t('pagination.next'), currentPage + 1, currentPage < totalPages)}
        {step(t('pagination.last'), totalPages, currentPage < totalPages)}
      </div>
    </nav>
  );
}
