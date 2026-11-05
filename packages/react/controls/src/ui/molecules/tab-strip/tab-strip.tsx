'use client';

import {
  Children,
  cloneElement,
  type ComponentPropsWithoutRef,
  isValidElement,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { useT } from '../../../i18n/index.js';
import { cn } from '../../utils/cn.js';

export interface TabStripProps
  extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** The {@link Tab}s, in order. */
  children?: ReactNode;
  /** The tablist's accessible name; the controls catalog's `tabs.list` when omitted. */
  label?: string;
  /**
   * What sits after the tabs — a {@link TabAddButton}. It is outside the
   * tablist, because a tablist may own nothing but tabs.
   */
  actions?: ReactNode;
}

/**
 * Arrow Left/Right (wrapping), Home and End move focus to a sibling tab in the
 * same tablist. Each tab handles its own keys, so the tablist stays a plain
 * container and the keyboard model holds for a Tab rendered anywhere.
 */
function moveFocus(event: KeyboardEvent<HTMLButtonElement>): boolean {
  const list = event.currentTarget.closest('[role="tablist"]');
  if (!list) return false;
  const all = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
  const from = all.indexOf(event.currentTarget);
  const to = {
    ArrowRight: (from + 1) % all.length,
    ArrowLeft: (from - 1 + all.length) % all.length,
    Home: 0,
    End: all.length - 1,
  }[event.key];
  if (to === undefined) return false;
  all[to]?.focus();
  return true;
}

/**
 * The workspace tab strip, on the WAI-ARIA tabs pattern: one Tab stop for the
 * whole list, Arrow Left/Right (wrapping), Home and End move between tabs, and
 * Enter or Space activates the focused one — activation is manual, because a
 * tab's body is a whole screen and rendering every one an arrow passes over is
 * work nobody asked for. Delete closes a closable tab (see {@link Tab}).
 *
 * Presentational: the open set, the order and the active tab come from the
 * caller. Each tab controls one {@link TabPanel}, which the caller renders.
 * Below the width of its tabs the list scrolls on its own, so the strip
 * reflows at 320px rather than widening the page.
 */
export function TabStrip({
  className,
  children,
  label,
  actions,
  ...props
}: TabStripProps) {
  const t = useT();
  const tabs = Children.toArray(children);
  // Roving tabindex: the active tab is the list's Tab stop, or the first tab
  // when none is active (a dead link shows no tab as its own).
  const anyActive = tabs.some(
    tab => isValidElement<TabProps>(tab) && tab.props.active === true,
  );
  const items = anyActive
    ? tabs
    : tabs.map((tab, index) =>
        index === 0 && isValidElement<TabProps>(tab)
          ? cloneElement(tab as ReactElement<TabProps>, { tabStop: true })
          : tab,
      );

  return (
    <div
      className={cn(
        'min-w-0 flex w-full items-end gap-3xs border-b border-border bg-surface px-2xs',
        className,
      )}
      {...props}
    >
      <div
        role="tablist"
        aria-label={label ?? t('tabs.list')}
        aria-orientation="horizontal"
        className="min-w-0 flex flex-1 items-end gap-3xs overflow-x-auto"
      >
        {items}
      </div>
      {actions}
    </div>
  );
}

/** `dirty` = unsaved draft; `saving` = autosave in flight; `error` = save failed. */
export type TabState = 'idle' | 'dirty' | 'saving' | 'error';

export interface TabProps {
  /** The tab's element id, which its {@link TabPanel} is labelled by. */
  id: string;
  label: string;
  /** The id of the {@link TabPanel} this tab shows, when it is the active one. */
  controls?: string;
  active?: boolean;
  state?: TabState;
  onSelect?: () => void;
  /** Makes the tab closable: by the × beside it, or Delete while it has focus. */
  onClose?: () => void;
  className?: string;
  /** Set by {@link TabStrip} on the first tab when none is active. */
  tabStop?: boolean;
}

/**
 * One tab. `role="tab"` sits on the button itself, so the tab is a single
 * interactive element; the close × beside it is a pointer convenience only —
 * hidden from assistive technology and out of the Tab order — and Delete on the
 * focused tab is its keyboard equivalent, announced through `aria-keyshortcuts`.
 *
 * The active tab lifts onto the surface (`bg-surface-elevated` + `-mb-px`, so
 * its base dissolves into the content plane below), and a non-idle tab shows
 * the autosave dot and its name says the same thing in words, since a dot alone is
 * colour carrying meaning (WCAG 1.4.1).
 */
export function Tab({
  id,
  label,
  controls,
  active = false,
  state = 'idle',
  onSelect,
  onClose,
  className,
  tabStop = active,
}: TabProps) {
  const t = useT();

  return (
    <div
      role="none"
      className={cn(
        'group relative flex shrink-0 items-center rounded-t-md text-step-sm',
        'transition duration-200 ease-smooth',
        active
          ? '-mb-px bg-surface-elevated font-medium text-content shadow-edge'
          : 'text-content-muted hover:bg-surface-elevated/60',
        state === 'error' && 'bg-danger-subtle text-danger',
        className,
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="pointer-events-none inset-x-0 top-0 absolute h-0.5 rounded-full bg-accent"
        />
      )}
      <button
        type="button"
        role="tab"
        id={id}
        aria-selected={active}
        aria-controls={active ? controls : undefined}
        aria-keyshortcuts={onClose ? 'Delete' : undefined}
        tabIndex={tabStop ? 0 : -1}
        onClick={onSelect}
        aria-label={
          state === 'idle'
            ? undefined
            : t('tabs.withState', { label, state: t(`tabs.${state}`) })
        }
        onKeyDown={event => {
          if (event.key === 'Delete' && onClose) {
            event.preventDefault();
            onClose();
          } else if (moveFocus(event)) {
            event.preventDefault();
          }
        }}
        className={cn(
          'min-h-(--target-min) flex max-w-48 items-center gap-2xs rounded-t-md py-2xs pl-s focus-ring',
          onClose ? 'pr-3xs' : 'pr-s',
        )}
      >
        <span className="truncate">{label}</span>
        {state !== 'idle' && (
          <span
            data-testid="tab-indicator"
            aria-hidden="true"
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              state === 'error' ? 'bg-danger' : 'bg-accent',
              state === 'saving' && 'animate-pulse motion-reduce:animate-none',
            )}
          />
        )}
      </button>
      {onClose && (
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          title={t('tabs.close', { label })}
          onClick={onClose}
          className={cn(
            'mr-3xs flex min-h-(--target-min) min-w-(--target-min) items-center justify-center rounded text-content-muted opacity-0 transition',
            'group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-surface hover:text-content',
            active && 'opacity-100',
          )}
        >
          ×
        </button>
      )}
    </div>
  );
}

export interface TabPanelProps extends ComponentPropsWithoutRef<'div'> {
  id: string;
  /** The id of the {@link Tab} that shows this panel. */
  labelledBy?: string;
}

/**
 * The region a tab shows. Focusable, as the pattern asks, so a keyboard user
 * can reach a panel whose content has nothing focusable of its own.
 */
export function TabPanel({ labelledBy, className, ...props }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      // The tabs pattern makes the panel itself a Tab stop.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      aria-labelledby={labelledBy}
      className={cn('focus-ring', className)}
      {...props}
    />
  );
}

export type TabAddButtonProps = ComponentPropsWithoutRef<'button'>;

/** The "+" that opens a new tab. Pass it as {@link TabStrip}'s `actions`. */
export function TabAddButton({ className, ...props }: TabAddButtonProps) {
  const t = useT();

  return (
    <button
      type="button"
      aria-label={t('tabs.new')}
      className={cn(
        'mb-3xs flex min-h-(--target-min) min-w-(--target-min) shrink-0 items-center justify-center rounded-md px-2xs text-step-sm text-content-muted',
        'transition hover:bg-surface-elevated hover:text-content',
        'focus-ring',
        className,
      )}
      {...props}
    >
      <span aria-hidden="true">+</span>
    </button>
  );
}
