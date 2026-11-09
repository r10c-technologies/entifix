'use client';

import {
  type ComponentPropsWithoutRef,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { cn } from '../../utils/cn.js';

export interface TableProps extends ComponentPropsWithoutRef<'table'> {
  /** Class names for the scroll container wrapping the `<table>`. */
  containerClassName?: string;
  /**
   * What the table holds — "Clientes, 12 resultados". It names the table and,
   * once the table overflows its container, the scroll region too.
   */
  caption?: ReactNode;
  /** Class names for the caption; screen-reader only unless overridden. */
  captionClassName?: string;
}

/**
 * Whether an element's content is larger than its box, on either axis —
 * measured again whenever the box or the content it holds resizes.
 */
function useOverflows(ref: RefObject<HTMLElement | null>): boolean {
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const node = ref.current as HTMLElement;
    const measure = () =>
      setOverflows(
        node.scrollWidth > node.clientWidth ||
          node.scrollHeight > node.clientHeight,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    // The table grows with its rows while the container keeps its size.
    for (const child of Array.from(node.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [ref]);
  return overflows;
}

/**
 * Styled table primitive — no entity knowledge, no data fetching. `EntityTable`
 * composes these; anything rendering non-entity tabular data can use them too.
 *
 * Wide tables scroll inside their own container rather than pushing the page
 * sideways. A container that scrolls is a **focusable region** named by the
 * caption, so a keyboard can scroll it — and one that fits is neither, so it
 * adds no tab stop that does nothing.
 */
export function Table({
  className,
  containerClassName,
  caption,
  captionClassName = 'sr-only',
  children,
  ...props
}: TableProps) {
  const container = useRef<HTMLDivElement>(null);
  const captionId = useId();
  const overflows = useOverflows(container);
  const named = caption !== undefined;

  return (
    <div
      ref={container}
      data-overflows={overflows || undefined}
      {...(overflows && {
        tabIndex: 0,
        role: named ? 'region' : undefined,
        'aria-labelledby': named ? captionId : undefined,
      })}
      className={cn(
        'w-full overflow-auto rounded-xl border border-border bg-surface-elevated focus-ring',
        containerClassName,
      )}
    >
      <table
        className={cn(
          'w-full border-collapse text-step-0 text-content',
          className,
        )}
        {...props}
      >
        {named && (
          <caption id={captionId} className={captionClassName}>
            {caption}
          </caption>
        )}
        {children}
      </table>
    </div>
  );
}

export function TableHead({
  className,
  ...props
}: ComponentPropsWithoutRef<'thead'>) {
  return (
    <thead
      // Sticky inside a container that scrolls: the column names stay in view
      // over a long page of rows. One layer above the rows, and no higher: a
      // row menu opened under it must still paint over it.
      className={cn(
        'top-0 sticky z-1 border-b border-border bg-surface',
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({
  className,
  ...props
}: ComponentPropsWithoutRef<'tbody'>) {
  return (
    <tbody className={cn('divide-y divide-border', className)} {...props} />
  );
}

export function TableRow({
  className,
  ...props
}: ComponentPropsWithoutRef<'tr'>) {
  return (
    <tr
      className={cn(
        'transition-colors duration-200 ease-smooth hover:bg-surface',
        className,
      )}
      {...props}
    />
  );
}

export type TableCellAlign = 'start' | 'center' | 'end';

const ALIGN_CLASS: Record<TableCellAlign, string> = {
  start: 'text-left',
  center: 'text-center',
  end: 'text-right',
};

// `align` shadows the deprecated HTML attribute, which allows a different set
// of values — omit the native one rather than narrow it.
export interface TableHeaderCellProps extends Omit<
  ComponentPropsWithoutRef<'th'>,
  'align'
> {
  align?: TableCellAlign;
}

export function TableHeaderCell({
  align = 'start',
  className,
  ...props
}: TableHeaderCellProps) {
  return (
    <th
      scope="col"
      className={cn(
        'px-s py-2xs text-step-sm font-semibold whitespace-nowrap text-content-muted',
        ALIGN_CLASS[align],
        className,
      )}
      {...props}
    />
  );
}

export interface TableCellProps extends Omit<
  ComponentPropsWithoutRef<'td'>,
  'align'
> {
  align?: TableCellAlign;
}

export function TableCell({
  align = 'start',
  className,
  ...props
}: TableCellProps) {
  return (
    <td
      className={cn('px-s py-2xs align-middle', ALIGN_CLASS[align], className)}
      {...props}
    />
  );
}

/** Full-width message row — empty results, an error, a loading state. */
export function TableMessageRow({
  colSpan,
  className,
  ...props
}: ComponentPropsWithoutRef<'td'> & { colSpan: number }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className={cn(
          'px-s py-m text-center text-step-sm text-content-muted',
          className,
        )}
        {...props}
      />
    </tr>
  );
}
