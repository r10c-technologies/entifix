/**
 * Where a flow can be watched: its status read and its stream.
 *
 * The same two links a `202 flowAccepted` body carries.
 */
export interface FlowLink {
  readonly rel: 'status' | 'stream';
  readonly href: string;
}

/** A write that happened: `200` or `201`, and what the service answered. */
export interface Settled<T> {
  readonly _tag: 'settled';
  readonly value: T;
}

/**
 * A write handed to a flow: `202 flowAccepted`. Nothing about its outcome is
 * known yet, and nothing here claims one — only the flow's own events say
 * whether it completed
 * ([ADR 0022](../../../../../docs/adr/0022-two-settle-modes-and-the-pending-flow-store.md)).
 */
export interface Pending {
  readonly _tag: 'pending';
  readonly flowId: string;
  readonly links: readonly FlowLink[];
}

/**
 * What a save, a delete or a verb answers. The server picks the mode; a
 * client handles both through one API and never branches on a status code.
 */
export type WriteResult<T> = Settled<T> | Pending;

export const settled = <T>(value: T): Settled<T> => ({
  _tag: 'settled',
  value,
});

export const pending = (
  flowId: string,
  links: readonly FlowLink[] = [],
): Pending => ({ _tag: 'pending', flowId, links });

export const isPending = <T>(result: WriteResult<T>): result is Pending =>
  result._tag === 'pending';

/** The link of `rel` a pending write named, if it named one. */
export const flowLink = (
  result: Pending,
  rel: FlowLink['rel'],
): string | undefined => result.links.find(link => link.rel === rel)?.href;
