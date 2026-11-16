'use client';

import { Children, isValidElement, type ReactNode } from 'react';

import { useFormatters, useLocale, useT } from '../../../i18n/index.js';
import { Alert } from '../../atoms/alert/index.js';
import { Button } from '../../atoms/button/index.js';
import { Money, type MoneyUnit } from '../../atoms/money/index.js';
import { Skeleton } from '../../atoms/skeleton/index.js';
import { StatusTag, type StatusTagTone } from '../../atoms/status-tag/index.js';
import { Cluster, type ClusterProps } from '../../layout/cluster/index.js';
import { cn } from '../../utils/cn.js';

/** An amount of money a tile states instead of a count. */
export interface SummaryTileMoney {
  readonly amount: number;
  readonly currency: string;
  readonly unit: MoneyUnit;
}

/** What the tile's figure means at a glance, in a tone and in words. */
export interface SummaryTileStatus {
  readonly tone: StatusTagTone;
  /** The words for it; the tone never stands alone. */
  readonly label: string;
}

/** One record a list tile leads to — "Pedido 1042", and when it was placed. */
export interface SummaryTileItem {
  readonly href: string;
  /** What the record is called; the link's name. */
  readonly label: string;
  /** A muted detail after it — a date, an amount, a status in words. */
  readonly meta?: ReactNode;
}

export interface SummaryTileProps {
  /** What is counted — "Envíos por despachar". The tile's heading. */
  label: string;
  /** Where the counted records are: the tile is one link there. */
  href: string;
  /** How many. Ignored when {@link money} is given. */
  count?: number;
  /** An amount instead of a count — "Próximo pago". */
  money?: SummaryTileMoney;
  /**
   * A short list instead of a figure — "Últimos pedidos". The heading links
   * to all of them and each item to its own record, so the tile is not one
   * link. Ignored when {@link money} is given; takes precedence over
   * {@link count}.
   */
  items?: readonly SummaryTileItem[];
  /** What an empty list says. A neutral "nothing yet" when omitted. */
  emptyLabel?: string;
  /** The figure's meaning as a tag beside it. */
  status?: SummaryTileStatus;
  /** Its own source's state: one tile failing leaves every other one standing. */
  state: 'loading' | 'ready' | 'failed';
  /** Reads the tile's source again. Without it, a failed tile offers no Retry. */
  onRetry?: () => void;
  /**
   * Routing escape hatch. It receives the tile's `href`, `className` and
   * content, and must spread `className` onto what it renders; a plain `<a>`
   * when omitted.
   */
  renderLink?: (link: {
    href: string;
    className: string;
    children: ReactNode;
  }) => ReactNode;
  className?: string;
}

const SURFACE =
  'flex min-h-(--target-min) flex-col gap-2xs rounded-xl border border-border bg-surface-elevated p-s text-content';
const LINK =
  'block rounded-xl text-content no-underline focus-ring hover:shadow-overlay';
const HEADING_LINK = 'focus-ring rounded-sm text-content hover:underline';
const ITEM_LINK = `inline-flex min-h-(--target-min) items-center ${HEADING_LINK}`;

/**
 * One figure that leads somewhere: a heading, a count or an amount, and a
 * status in words. The whole tile is one link to the records it counts, named
 * by its heading and its figure. It loads, and fails, on its own — a failed
 * tile says so in place and offers Retry while its neighbours keep their
 * figures ([ADR 0028](../../../../../../../docs/adr/0028-states-an-organism-must-render.md)).
 * Nothing is announced live: the figure is read once, when the reader
 * reaches it.
 */
export function SummaryTile({
  label,
  href,
  count,
  money,
  items,
  emptyLabel,
  status,
  state,
  onRetry,
  renderLink,
  className,
}: SummaryTileProps) {
  const t = useT();
  const formatters = useFormatters();
  const locale = useLocale();
  const linkTo = (to: string, content: ReactNode, linkClass: string) =>
    renderLink === undefined ? (
      <a href={to} className={linkClass}>
        {content}
      </a>
    ) : (
      renderLink({ href: to, className: linkClass, children: content })
    );
  const link = (content: ReactNode, linkClass: string) =>
    linkTo(href, content, linkClass);

  if (state === 'failed') {
    return (
      <article className={cn(SURFACE, className)}>
        <h3 className="text-step-sm font-semibold">
          {link(label, HEADING_LINK)}
        </h3>
        <Alert
          tone="danger"
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
          {t('summary.failed', { label })}
        </Alert>
      </article>
    );
  }

  // A list tile holds a link per record, and links cannot nest: its heading
  // is the link to all of them rather than the whole tile.
  if (items !== undefined && money === undefined) {
    return (
      <article className={cn(SURFACE, className)}>
        <h3 className="text-step-sm font-semibold">
          {link(label, HEADING_LINK)}
        </h3>
        {state === 'loading' ? (
          <>
            <Skeleton shape="line" className="w-full" />
            <Skeleton shape="line" className="w-3/4" />
            <span className="sr-only">{t('summary.loading')}</span>
          </>
        ) : items.length === 0 ? (
          <p className="m-0 text-step-sm text-content-muted">
            {emptyLabel ?? t('summary.empty')}
          </p>
        ) : (
          <ul role="list" className="m-0 p-0 flex list-none flex-col gap-2xs">
            {items.map(item => (
              <li
                key={item.href}
                className="flex flex-wrap items-baseline justify-between gap-x-s"
              >
                {linkTo(item.href, item.label, ITEM_LINK)}
                {item.meta !== undefined && (
                  <span className="text-step-sm text-content-muted tabular-nums">
                    {item.meta}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {state === 'ready' && status !== undefined && (
          <StatusTag tone={status.tone} className="self-start">
            {status.label}
          </StatusTag>
        )}
      </article>
    );
  }

  const figure =
    state === 'loading' ? (
      <>
        <Skeleton shape="line" className="w-12" />
        <span className="sr-only">{t('summary.loading')}</span>
      </>
    ) : money !== undefined ? (
      <Money
        amount={money.amount}
        currency={money.currency}
        unit={money.unit}
        locale={locale}
      />
    ) : (
      formatters.number(count ?? 0)
    );

  return link(
    <article className={cn(SURFACE, className)}>
      <h3 className="text-step-sm font-semibold">{label}</h3>
      <div className="text-step-2 font-semibold tabular-nums">{figure}</div>
      {state === 'ready' && status !== undefined && (
        <StatusTag tone={status.tone} className="self-start">
          {status.label}
        </StatusTag>
      )}
    </article>,
    LINK,
  );
}

export type SummaryTileListProps = Omit<ClusterProps, 'as' | 'role' | 'align'>;

/** Tiles side by side, wrapping as the width runs out; a list, so its size is read out. */
export function SummaryTileList({ children, ...props }: SummaryTileListProps) {
  return (
    <Cluster as="ul" role="list" gap="s" align="stretch" {...props}>
      {Children.map(children, child =>
        isValidElement(child) ? <li className="min-w-0">{child}</li> : child,
      )}
    </Cluster>
  );
}
