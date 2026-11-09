'use client';

import type { Formatters, Locale } from '@entifix/core';
import {
  defaultLocale,
  type Entity,
  EntityCollectionLink,
  type EntityFieldDescriptor,
  EntityLink,
  isLocalizedText,
  localize,
  type MetaAccessorType,
} from '@entifix/core';

import {
  useEnumLabel,
  useFormatters,
  useLocale,
  useT,
} from '../../../i18n/index.js';
import { Money } from '../money/money.js';
import { currencyOf } from '../money/money-math.js';
import { Skeleton } from '../skeleton/index.js';

/** Stand-in for an absent value, so an empty cell still reads as intentional. */
const EMPTY = '—';

/**
 * A link reads as its target's label once the target is loaded (embedded or
 * resolved). Never as its id: a key is not a name, and showing one fails the
 * reader who came to see which record it is (#200).
 */
function entityLabel(
  target: Entity | undefined,
  linkLabelProperty: string,
  locale: Locale,
): string | undefined {
  const label = (target as Record<string, unknown> | undefined)?.[
    linkLabelProperty
  ];
  if (label == null) return undefined;
  // A target labelled by a localized member reads in the reader's locale.
  return isLocalizedText(label) ? localize(label, locale) : String(label);
}

function formatLink(
  link: EntityLink<Entity>,
  linkLabelProperty: string,
  locale: Locale,
): string {
  return link.id == null
    ? EMPTY
    : (entityLabel(link.value, linkLabelProperty, locale) ?? EMPTY);
}

function formatCollectionLink(
  link: EntityCollectionLink<Entity>,
  linkLabelProperty: string,
  locale: Locale,
): string {
  return (link.values ?? [])
    .map(target => entityLabel(target, linkLabelProperty, locale) ?? EMPTY)
    .join(', ');
}

/**
 * Everything locale-dependent, resolved once by the component and handed down.
 * The formatters carry an explicit locale, which is what keeps a date rendered
 * on the server byte-identical to the same date rendered in the browser.
 */
interface CellFormatting {
  readonly formatters: Formatters;
  readonly yes: string;
  readonly no: string;
  readonly enumLabel: (value: string) => string;
  readonly rowCount: (count: number) => string;
  readonly locale: Locale;
}

function formatByType(
  value: unknown,
  type: MetaAccessorType,
  linkLabelProperty: string,
  formatting: CellFormatting,
): string {
  switch (type) {
    case 'date':
      return formatting.formatters.date(
        value instanceof Date ? value : String(value),
      );
    case 'number':
      return typeof value === 'number'
        ? formatting.formatters.number(value)
        : String(value);
    case 'boolean':
      return value ? formatting.yes : formatting.no;
    case 'enum':
      return formatting.enumLabel(String(value));
    case 'link':
      return value instanceof EntityLink
        ? formatLink(value, linkLabelProperty, formatting.locale)
        : String(value);
    case 'linkCollection':
      return value instanceof EntityCollectionLink
        ? formatCollectionLink(value, linkLabelProperty, formatting.locale)
        : String(value);
    case 'scalarCollection':
      // The same comma list the draft holds, spaced for reading. Not `String`:
      // an array's own `toString` joins on a bare comma, which reads as one
      // run-on token in a narrow column.
      return Array.isArray(value) ? value.join(', ') : String(value);
    case 'composition':
      // Owned rows have no useful one-line form — a receipt's lines are not a
      // sentence — and the master's own screen is where they are read and
      // edited. So the cell reports the count and stops.
      return Array.isArray(value)
        ? formatting.rowCount(value.length)
        : String(value);
    case 'localized':
      // The reader's locale, falling back to the host's default; a value
      // that is not a text per locale has no reading worth guessing at.
      return isLocalizedText(value)
        ? (localize(value, formatting.locale) ?? '')
        : '';
    default:
      return String(value);
  }
}

/**
 * Tabular figures, applied once, here — not on `--font-sans` and not per call
 * site. A column of numbers or dates must align on the digit; a paragraph must
 * not, because proportional figures are what prose is set in. The descriptor
 * already knows which is which, so the cell is the only place that has to.
 */
const NUMERIC_CLASS: Partial<Record<MetaAccessorType, string>> = {
  number: 'tabular-nums',
  date: 'tabular-nums',
};

export interface CellValueProps {
  value: unknown;
  descriptor: EntityFieldDescriptor;
  /**
   * The record the value belongs to. A money member whose currency is another
   * member of the record (`money.currencyMember`) reads it from here.
   */
  record?: Readonly<Record<string, unknown>>;
}

/**
 * Renders one entity member according to its metadata type. Centralizing this
 * is what lets a table stay generic: a link, a date and a number all arrive as
 * "the value of an accessor", and only the descriptor decides how they read.
 */
export function CellValue({ value, descriptor, record }: CellValueProps) {
  const t = useT();
  const formatters = useFormatters();
  const enumLabel = useEnumLabel();
  const locale = useLocale();

  if (value === undefined || value === null || value === '') {
    return <span className="text-content-muted">{EMPTY}</span>;
  }

  // An amount reads as money in the reader's locale, never as the stored
  // number. A draft holds it as a string, so a numeric string counts too. A
  // currency the record does not carry leaves it a plain number rather than
  // guessing one.
  if (descriptor.money !== undefined) {
    const amount = typeof value === 'number' ? value : Number(value);
    const currency = currencyOf(descriptor.money, record);
    if (currency !== undefined && Number.isFinite(amount)) {
      return (
        <Money
          amount={amount}
          currency={currency}
          unit={descriptor.money.unit}
          locale={locale}
        />
      );
    }
  }

  // A relation whose target has not arrived yet holds its place with a
  // skeleton — the id is all it has, and the id is not what it means.
  if (
    (value instanceof EntityLink &&
      value.id != null &&
      value.value === undefined) ||
    (value instanceof EntityCollectionLink &&
      value.ids.length > 0 &&
      value.values === undefined)
  ) {
    return <Skeleton shape="line" className="w-16" />;
  }

  const text = formatByType(
    value,
    descriptor.type,
    descriptor.linkLabelProperty,
    {
      formatters,
      yes: t('value.yes'),
      no: t('value.no'),
      enumLabel: raw => enumLabel(descriptor, raw),
      rowCount: count => t('value.rowCount', { count }),
      locale,
    },
  );

  if (text === '') {
    return <span className="text-content-muted">{EMPTY}</span>;
  }

  // Text the reader's locale lacks falls back to the default locale's, and is
  // marked as that language, so it is read in its own voice (WCAG 3.1.2).
  if (
    descriptor.type === 'localized' &&
    isLocalizedText(value) &&
    (value[locale] ?? '') === ''
  ) {
    return <span lang={defaultLocale()}>{text}</span>;
  }

  return (
    <span className={NUMERIC_CLASS[descriptor.type] ?? undefined}>{text}</span>
  );
}
