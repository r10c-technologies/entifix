import type { ReactNode } from 'react';

import { cn } from '../../utils/cn.js';

export interface TableToolbarProps {
  /** Actions aligned to the start — titles, primary actions. */
  start?: ReactNode;
  /** Actions aligned to the end — column settings, panel toggles. */
  end?: ReactNode;
  /** Expanded panel rendered below the bar (filters, sorting). */
  panel?: ReactNode;
  /** The panel's id, for the toggle that opens it to name in `aria-controls`. */
  panelId?: string;
  className?: string;
}

/** Bar above a table: actions on one line, an optional expanded panel below. */
export function TableToolbar({
  start,
  end,
  panel,
  panelId,
  className,
}: TableToolbarProps) {
  return (
    <div className={cn('flex flex-col gap-2xs', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2xs">
        <div className="min-w-0 flex flex-1 flex-wrap items-center gap-2xs">
          {start}
        </div>
        <div className="flex flex-wrap items-center gap-2xs">{end}</div>
      </div>
      {panel && (
        <div
          id={panelId}
          className="rounded-xl border border-border bg-surface p-s"
        >
          {panel}
        </div>
      )}
    </div>
  );
}
