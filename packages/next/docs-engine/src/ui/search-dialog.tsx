'use client';

import { useT } from '@entifix/react-controls';
import { useDocsSearch } from 'fumadocs-core/search/client';
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from 'fumadocs-ui/components/dialog/search';
import { useMemo } from 'react';

import { loadPagefind, toSortedResults } from './pagefind.js';

export interface PagefindSearchDialogProps extends SharedProps {
  /** Where `pagefind --site` wrote its index, with the app's `basePath`: `/docs/pagefind/`. */
  readonly indexUrl: string;
}

/**
 * The search dialog over the exported site's Pagefind index (entifix #276).
 *
 * fumadocs' own dialog is replaced for one reason it cannot be configured out
 * of: its Close button is named "Close Search" and reads "ESC", which fails
 * WCAG 2.5.3 (a control's name contains its visible text). Here the name
 * begins with the very word the button shows (ADR 0031 §4.1).
 */
export default function PagefindSearchDialog({
  indexUrl,
  ...props
}: PagefindSearchDialogProps) {
  const t = useT('controls');
  const client = useMemo(() => {
    const pagefind = loadPagefind(indexUrl);
    return {
      search: async (query: string) => toSortedResults(await pagefind(), query),
      deps: [indexUrl],
    };
  }, [indexUrl]);
  const search = useDocsSearch({ client });
  return (
    <SearchDialog {...search} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon aria-hidden="true" />
          <SearchDialogInput />
          <SearchDialogClose aria-label={t('docs.search.close')}>
            {t('docs.search.closeKey')}
          </SearchDialogClose>
        </SearchDialogHeader>
        <SearchDialogList />
      </SearchDialogContent>
    </SearchDialog>
  );
}
