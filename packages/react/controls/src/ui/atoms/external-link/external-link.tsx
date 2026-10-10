import type { ComponentPropsWithoutRef } from 'react';

/**
 * A link that leaves the site: a new tab, with no `window.opener` and no
 * referrer handed to the other side.
 */
export function ExternalLink(
  props: ComponentPropsWithoutRef<'a'> & { href: string },
) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}
