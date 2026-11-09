import { type ReactNode, useId } from 'react';

import { cn } from '../../utils/cn.js';

/** One line of a card: a member's label and its value. */
export interface EntityRecordCardMeta {
  key: string;
  label: ReactNode;
  value: ReactNode;
}

export interface EntityRecordCardProps {
  /**
   * The record's heading — what it is read as, usually a link to it. A link
   * here is stretched over the whole card, so the card is one target.
   */
  title: ReactNode;
  /** A line under the heading. */
  subtitle?: ReactNode;
  /** Short values beside the heading — a status. */
  badges?: readonly { key: string; value: ReactNode }[];
  /** The record's other members, as a description list. */
  meta: readonly EntityRecordCardMeta[];
  /**
   * Above the heading: a selection box. It is not an action on the record —
   * it decides whether the record is *in the set* the actions run over — so it
   * does not sit with them.
   */
  leading?: ReactNode;
  /** Above the heading, at the end: the record's menu. */
  actions?: ReactNode;
  className?: string;
}

/**
 * A record pivoted from a row into a card: the narrow form of a table row,
 * where a horizontal scroll would hide most columns.
 *
 * An `article` named by its `h3`, so a reader can move card by card with the
 * heading keys and hears what each record is. The title's link is stretched
 * over the card; the selection box and the menu sit above it, so they stay
 * their own targets.
 */
export function EntityRecordCard({
  title,
  subtitle,
  badges = [],
  meta,
  leading,
  actions,
  className,
}: EntityRecordCardProps) {
  const titleId = useId();

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        'relative rounded-xl border border-border bg-surface-elevated p-s text-content shadow-edge focus-within:border-primary',
        className,
      )}
    >
      {(leading !== undefined || actions !== undefined) && (
        <div className="relative z-1 mb-2xs flex items-center justify-between gap-2xs">
          <div className="flex">{leading}</div>
          <div className="flex">{actions}</div>
        </div>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-2xs">
        <h3
          id={titleId}
          className="m-0 [&_a]:after:inset-0 text-step-0 font-semibold [&_a]:after:absolute [&_a]:after:content-['']"
        >
          {title}
        </h3>
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-3xs">
            {badges.map(badge => (
              <span
                key={badge.key}
                className="rounded-full border border-border px-2xs text-step-sm"
              >
                {badge.value}
              </span>
            ))}
          </div>
        )}
      </div>
      {subtitle !== undefined && (
        <p className="m-0 text-step-sm text-content-muted">{subtitle}</p>
      )}
      {meta.length > 0 && (
        <dl className="mt-2xs flex flex-col gap-2xs">
          {meta.map(line => (
            <div
              key={line.key}
              className="flex items-baseline justify-between gap-2xs"
            >
              <dt className="tracking-wide text-step-xs text-content-muted uppercase">
                {line.label}
              </dt>
              <dd className="m-0 text-right text-step-sm">{line.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}
