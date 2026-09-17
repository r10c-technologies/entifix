import type { EntityId } from '@entifix/core';
import type { ReactNode } from 'react';

/**
 * What a navigation control means, so a host can do something other than follow
 * the `href`.
 *
 * `open` goes to a record, `new` to its create form, `back` to the list. A
 * workspace tab needs to know which, because it answers each by opening a tab —
 * and a URL alone does not say what it points at without the host parsing its
 * own routes back.
 */
export type NavigationIntent =
  | { readonly kind: 'open'; readonly id: EntityId }
  | { readonly kind: 'new' }
  | { readonly kind: 'back' };

export interface RenderLinkProps {
  /** Always a real URL: middle-click and "open in new tab" must keep working. */
  readonly href: string;
  /** The styling the control would carry as a plain anchor. */
  readonly className: string;
  readonly children: ReactNode;
  readonly intent: NavigationIntent;
}

/**
 * Renders a navigation control.
 *
 * A seam rather than a router dependency: this package runs under any router or
 * none, so a plain anchor is all it can render by itself — and a plain anchor in
 * a client-routed application is a full document load, which rebuilds the
 * bundle, empties every cache and, inside a workspace tab, leaves the workspace.
 * A host passes a renderer built on its own link component instead.
 */
export type RenderLink = (props: RenderLinkProps) => ReactNode;

/** The fallback: a plain anchor. */
export const renderAnchor: RenderLink = ({ href, className, children }) => (
  <a href={href} className={className}>
    {children}
  </a>
);
