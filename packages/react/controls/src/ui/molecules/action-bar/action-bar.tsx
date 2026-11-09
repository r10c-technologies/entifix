'use client';

import type { UseCaseDescriptor } from '@entifix/core';
import { Fragment, type ReactNode } from 'react';

import { useT } from '../../../i18n/index.js';
import {
  type ActionSurface,
  type NavigationIntent,
  OVERFLOW_GLYPH,
  renderAnchor,
  type RenderLink,
} from '../../actions/index.js';
import { ariaKeyShortcuts } from '../../actions/shortcut.js';
import { Button, button } from '../../atoms/button/index.js';
import { cn } from '../../utils/cn.js';
import { useHotkey } from '../../utils/use-hotkey.js';
import { Menu } from '../menu/index.js';

/** Every surface an {@link ActionBar} renders: the palette lists, it does not render a bar. */
export type ActionBarSurface = Exclude<ActionSurface, 'command-palette'>;

/**
 * Surfaces that are a **page** — a record's header and footer, a list's
 * toolbar. A destructive verb is never the primary there: the thing a page is
 * for is not destroying it. A selection's bar and a row are not pages, and
 * deleting what was selected may well be what the bar is for.
 */
const PAGE_SURFACES: ReadonlySet<ActionBarSurface> = new Set([
  'form-header',
  'form-footer',
  'table-toolbar',
]);

/** How many secondaries stay visible beside the primary before the rest fold. */
export const VISIBLE_SECONDARIES = 3;

/** One action in a bar: a declared verb, or one the surface brings itself (Save, New). */
export interface ActionBarItem {
  readonly key: string;
  /** Already in the reader's language. */
  readonly label: string;
  readonly emphasis?: 'primary' | 'default';
  /** Order among the secondaries, lowest first; absent keeps the given order. */
  readonly priority?: number;
  readonly destructive?: boolean;
  /** Shown on a row itself rather than only in its menu. */
  readonly rowInline?: boolean;
  readonly shortcut?: string;
  readonly disabled?: boolean;
  /**
   * An action that navigates rather than acts — a list's "New". It is never
   * folded into a menu, whatever its emphasis: a menu entry is a button, and a
   * link must stay a link so it can be opened in a new tab.
   */
  readonly href?: string;
  /** What the link means, for a host that answers navigation itself. */
  readonly intent?: NavigationIntent;
  readonly onSelect?: () => void;
  /**
   * Submits the form the bar sits in — a form's Save — so Enter in a field
   * saves too. As a button it leaves the act to the form's submit handler; in
   * a menu, where a menu item cannot submit, it runs `onSelect`.
   */
  readonly submit?: boolean;
}

export interface ActionBarProps {
  readonly surface: ActionBarSurface;
  readonly items: readonly ActionBarItem[];
  /**
   * The overflow trigger's name. Defaults to "More actions"; a row passes
   * "Actions for {record}", so a list of rows is not a list of identical
   * buttons.
   */
  readonly menuLabel?: string;
  readonly size?: 'sm' | 'md';
  readonly renderLink?: RenderLink;
  readonly className?: string;
}

/**
 * The bar items for declared verbs: label translated, weight and order carried
 * from the descriptor, every one routed through `onSelect` — which is where a
 * surface's `invoke()` asks for a confirmation, so no surface can reach a verb
 * around it.
 */
export function itemsForUseCases(
  descriptors: readonly UseCaseDescriptor[],
  translate: (key: string) => string,
  onSelect: (descriptor: UseCaseDescriptor) => void,
  disabled = false,
): ActionBarItem[] {
  return descriptors.map(descriptor => ({
    key: descriptor.key,
    label: translate(descriptor.labelKey),
    emphasis: descriptor.emphasis,
    priority: descriptor.priority,
    destructive: descriptor.confirm?.tone === 'destructive',
    rowInline: descriptor.rowInline === true,
    shortcut: descriptor.shortcut,
    disabled,
    onSelect: () => onSelect(descriptor),
  }));
}

/**
 * Secondaries in the order they render: by priority, then as given, with the
 * destructive ones last so a separator can stand between "do" and "destroy".
 */
function ordered(items: readonly ActionBarItem[]): ActionBarItem[] {
  const ranked = items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        (a.item.priority ?? Infinity) - (b.item.priority ?? Infinity) ||
        a.index - b.index,
    )
    .map(({ item }) => item);
  return [
    ...ranked.filter(item => !item.destructive),
    ...ranked.filter(item => item.destructive),
  ];
}

function assertHierarchy(
  surface: ActionBarSurface,
  items: readonly ActionBarItem[],
): ActionBarItem | undefined {
  const primaries = items.filter(item => item.emphasis === 'primary');
  if (primaries.length > 1) {
    throw new Error(
      `The ${surface} surface has ${primaries.length} primary actions (${primaries
        .map(item => item.key)
        .join(
          ', ',
        )}). A surface has one thing it is for: declare one primary and give the rest the default emphasis.`,
    );
  }
  const [primary] = primaries;
  if (primary?.destructive && PAGE_SURFACES.has(surface)) {
    throw new Error(
      `"${primary.key}" is destructive and declared primary on ${surface}. A page is never for destroying itself: give it the default emphasis, and it renders last, after a separator.`,
    );
  }
  return primary;
}

/**
 * One way every surface renders its verbs
 * ([ADR 0026](../../../../../../../docs/adr/0026-actions-hierarchy-overflow-and-destructive-verbs.md)):
 * the primary, then up to {@link VISIBLE_SECONDARIES} secondaries, then a
 * "More actions" menu button holding the rest — destructive verbs last, after
 * a separator.
 *
 * ⚠️ **It collapses by container, not by viewport.** Below the container's
 * `md` width it renders the primary and one menu holding every secondary; a
 * bar inside a split view or a drawer is as narrow as its container, whatever
 * the window is. Both arrangements are in the DOM and CSS shows one, so the
 * server renders the right one with no measurement.
 *
 * A row renders differently: the verb it declares `rowInline` sits on the row,
 * and everything else is in one menu named for the record.
 *
 * It throws on a second primary, and on a destructive primary on a page
 * surface — both are declarations no rendering can make sensible.
 */
export function ActionBar({
  surface,
  items,
  menuLabel,
  size = 'sm',
  renderLink = renderAnchor,
  className,
}: ActionBarProps) {
  const t = useT();
  const primary = assertHierarchy(surface, items);
  // A row's verbs are bound nowhere — every row would claim the same chord —
  // so they advertise none. Every other surface binds what it advertises.
  const bindsShortcuts = surface !== 'row-menu';
  const keyShortcuts = (item: ActionBarItem) =>
    bindsShortcuts && item.shortcut !== undefined
      ? ariaKeyShortcuts(item.shortcut)
      : undefined;
  const label = menuLabel ?? t('actions.more');

  const asButton = (item: ActionBarItem, variant: 'primary' | 'secondary') =>
    item.href === undefined ? (
      <Button
        key={item.key}
        type={item.submit ? 'submit' : 'button'}
        variant={item.destructive ? 'destructive' : variant}
        size={size}
        disabled={item.disabled}
        aria-keyshortcuts={keyShortcuts(item)}
        onClick={item.submit ? undefined : item.onSelect}
      >
        {item.label}
      </Button>
    ) : (
      <span key={item.key} className="contents">
        {renderLink({
          href: item.href,
          className: button({ variant, size }),
          children: item.label,
          intent: item.intent ?? { kind: 'new' },
        })}
      </span>
    );

  const menu = (folded: readonly ActionBarItem[], key: string): ReactNode => {
    if (folded.length === 0) return undefined;
    const firstDestructive = folded.findIndex(item => item.destructive);
    return (
      <Menu key={key}>
        <Menu.Trigger aria-label={label} title={label}>
          {OVERFLOW_GLYPH}
        </Menu.Trigger>
        <Menu.Items>
          {folded.map((item, index) => (
            <Fragment key={item.key}>
              {index > 0 && index === firstDestructive && <Menu.Separator />}
              <Menu.Item
                tone={item.destructive ? 'destructive' : 'neutral'}
                disabled={item.disabled}
                aria-keyshortcuts={keyShortcuts(item)}
                onClick={item.onSelect}
              >
                {item.label}
              </Menu.Item>
            </Fragment>
          ))}
        </Menu.Items>
      </Menu>
    );
  };

  if (surface === 'row-menu') {
    const inline = items.filter(item => item.rowInline);
    return (
      <span className={cn('flex items-center gap-2xs', className)}>
        {inline.map(item => asButton(item, 'secondary'))}
        {menu(ordered(items.filter(item => !item.rowInline)), 'row')}
      </span>
    );
  }

  const links = items.filter(
    item => item !== primary && item.href !== undefined,
  );
  const secondaries = ordered(
    items.filter(item => item !== primary && item.href === undefined),
  );
  const visible = secondaries.slice(0, VISIBLE_SECONDARIES);
  const separatorAt = visible.findIndex(item => item.destructive);
  // A menu holding one entry is strictly worse than the button it replaced.
  const collapses = secondaries.length > 1;

  return (
    <div
      className={cn('min-w-0 @container/actions flex-1', className)}
      data-surface={surface}
    >
      {items.map(item =>
        item.shortcut === undefined ||
        item.onSelect === undefined ||
        item.href !== undefined ? null : (
          <ItemShortcut
            key={item.key}
            chord={item.shortcut}
            onSelect={item.onSelect}
            enabled={item.disabled !== true}
          />
        ),
      )}
      <div className="flex flex-wrap items-center gap-2xs">
        {primary && asButton(primary, 'primary')}
        {links.map(item => asButton(item, 'secondary'))}
        <div
          className={cn(
            'flex-wrap items-center gap-2xs',
            collapses ? '@md/actions:flex hidden' : 'flex',
          )}
          data-arrangement="wide"
        >
          {visible.map((item, index) => (
            <span key={item.key} className="contents">
              {index > 0 && index === separatorAt && (
                <span
                  aria-hidden="true"
                  className="w-px self-stretch bg-border"
                />
              )}
              {asButton(item, 'secondary')}
            </span>
          ))}
          {menu(secondaries.slice(VISIBLE_SECONDARIES), 'overflow')}
        </div>
        {collapses && (
          <div className="@md/actions:hidden flex" data-arrangement="narrow">
            {menu(secondaries, 'collapsed')}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Binds one item's shortcut for as long as the bar shows it — yielding to a
 * binding already there, so a host's own chord wins over a surface's default.
 */
function ItemShortcut({
  chord,
  onSelect,
  enabled,
}: {
  chord: string;
  onSelect: () => void;
  enabled: boolean;
}) {
  useHotkey([chord], onSelect, { enabled, ifFree: true });
  return null;
}
