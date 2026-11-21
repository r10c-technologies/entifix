'use client';

import { useT } from '@entifix/react-controls';
import { useMemo } from 'react';

/**
 * fumadocs' own interface strings — keyed by their English text and a note —
 * answered from the controls catalog's `docs` block, so none of them is a
 * literal the host's `react/jsx-no-literals` gate cannot see (ADR 0031 §4.6).
 *
 * The keys fumadocs has that this site never renders (AI chat, page actions,
 * GitHub links, the language switcher, the type table) are left out on
 * purpose: a string that is never shown needs no translation, and the
 * engine's e2e fails a page that shows an English one in Spanish.
 */
export const useDocsTranslations = (): Record<string, string> => {
  const t = useT('controls');
  return useMemo(
    () => ({
      'Search(search dialog)': t('docs.search.placeholder'),
      'Search(search trigger)': t('docs.search.open'),
      'Open Search(search trigger)(aria-label)': t('docs.search.open'),
      'Close Search(search dialog)(aria-label)': t('docs.search.close'),
      'No results found(search dialog)': t('docs.search.empty'),
      'Search failed(search dialog)': t('docs.search.failed'),
      'Search failed, showing results for {query}(search dialog)': t(
        'docs.search.failedFor',
      ),
      'Open Sidebar(sidebar)(aria-label)': t('docs.sidebar.open'),
      'Close Sidebar(sidebar)(aria-label)': t('docs.sidebar.close'),
      'Close Sidebar(aria-label)': t('docs.sidebar.close'),
      'Collapse Sidebar(sidebar)(aria-label)': t('docs.sidebar.collapse'),
      'Show Sidebar(sidebar)': t('docs.sidebar.show'),
      'Hide Sidebar(sidebar)': t('docs.sidebar.hide'),
      'Toggle Menu(mobile menu)(aria-label)': t('docs.menu'),
      'On this page(table of contents)': t('docs.toc.title'),
      'Table of Contents(inline table of contents)': t('docs.toc.title'),
      'No Headings(table of contents)': t('docs.toc.empty'),
      'Previous Page(pagination)': t('docs.page.previous'),
      'Next Page(pagination)': t('docs.page.next'),
      'Page Not Found(404 page)': t('docs.page.notFound'),
      'The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.(404 page)':
        t('docs.page.notFoundBody'),
      'Back to Home(404 page)': t('docs.page.home'),
      'Copy Text(code block)(aria-label)': t('docs.code.copy'),
      'Copied Text(code block)(aria-label)': t('docs.code.copied'),
      'Copy Anchor Link(heading anchor)(aria-label)': t('docs.anchor.copy'),
      'Copied Anchor Link(heading anchor)(aria-label)': t('docs.anchor.copied'),
      'Toggle Theme(theme switcher)(aria-label)': t('docs.theme'),
    }),
    [t],
  );
};
