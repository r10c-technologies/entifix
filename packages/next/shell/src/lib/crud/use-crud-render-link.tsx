'use client';

import type { RenderLink } from '@entifix/react-controls';
import Link from 'next/link';
import { type MouseEvent, useCallback } from 'react';

import { useEntityNavHost } from '../workspace/entity-nav.js';
import { CATALOG_NEW_SLUG } from './slug.js';

/**
 * A click the page may take over: the primary button with no modifier. Anything
 * else — middle-click, ⌘/Ctrl-click, Shift-click — is the visitor asking for the
 * link itself, in a new tab or window, and must be left to the browser.
 */
const isPlainClick = (event: MouseEvent<HTMLAnchorElement>): boolean =>
  !event.defaultPrevented &&
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

/**
 * How a generated page renders its Open, New and Back links (#20).
 *
 * A plain anchor was a full document load: the bundle rebuilt, every cache
 * emptied, and inside a workspace tab the click left the workspace for the route
 * page. So every link is `next/link` — a client-side navigation on a route host —
 * and, when a tab host is mounted, a plain click opens the matching tab instead:
 * the record, its create form (`<key>:new`), or the list. The `href` stays real
 * either way, so a modified click still opens the route in a new browser tab.
 */
export function useCrudRenderLink(entityKey: string): RenderLink {
  const host = useEntityNavHost();

  return useCallback<RenderLink>(
    ({ href, className, children, intent }) => (
      <Link
        href={href}
        className={className}
        onClick={event => {
          if (host === undefined || !isPlainClick(event)) return;
          event.preventDefault();
          if (intent.kind === 'open') {
            host.toEntity(entityKey, String(intent.id));
          } else if (intent.kind === 'new') {
            host.toEntity(entityKey, CATALOG_NEW_SLUG);
          } else {
            host.toList(entityKey);
          }
        }}
      >
        {children}
      </Link>
    ),
    [host, entityKey],
  );
}
