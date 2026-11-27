'use client';

import type { Formatters, Locale } from '@entifix/core';
import {
  defaultLocale,
  type Entity,
  EntityCollectionLink,
  type EntityFieldDescriptor,
  EntityLink,
  formatScaled,
  isLocalizedText,
  localize,
  type MetaAccessorType,
} from '@entifix/core';
import { useCallback } from 'react';

import {
  useEnumLabel,
  useFormatters,
  useLocale,
  useT,
  useTranslateKey,
} from '../../../i18n/index.js';
import {
  useReferenceLabel,
  useUnresolvedReference,
} from '../../utils/reference-labels.js';
import { Money } from '../money/money.js';
import { currencyOf } from '../money/money-math.js';
import { scaleOf } from '../scaled/scaled-math.js';
import { ScaledValue } from '../scaled/scaled-value.js';
import { useUnitLabel } from '../scaled/use-unit-label.js';
import { Skeleton } from '../skeleton/index.js';
import { StatusTag } from '../status-tag/index.js';

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
  readonly fixedScale: number | undefined;
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
      if (typeof value !== 'number') return String(value);
      // Words have no record to read a unit from, so only a fixed scale can
      // be honoured here.
      return formatting.fixedScale !== undefined && Number.isSafeInteger(value)
        ? formatScaled(value, formatting.fixedScale, formatting.locale)
        : formatting.formatters.number(value);
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
      // edited. So the cell reports the count, in the noun the member declares
      // (`countLabelKey`), and stops: never in the table's own word for a row.
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

/** The formatting {@link formatByType} reads, resolved for the reader. */
function useCellFormatting(): (
  descriptor: EntityFieldDescriptor,
) => CellFormatting {
  const t = useT();
  const translate = useTranslateKey();
  const formatters = useFormatters();
  const enumLabel = useEnumLabel();
  const locale = useLocale();
  return useCallback(
    descriptor => ({
      formatters,
      yes: t('value.yes'),
      no: t('value.no'),
      enumLabel: raw => enumLabel(descriptor, raw),
      rowCount: count =>
        descriptor.countLabelKey === undefined
          ? formatters.number(count)
          : translate(descriptor.countLabelKey, { count }),
      locale,
      fixedScale: descriptor.scaled?.scale,
    }),
    [enumLabel, formatters, locale, t, translate],
  );
}

/**
 * A filled-in member's value as one line of text, exactly as its cell reads
 * it — for the places that need words rather than an element: a checkbox's
 * name, a confirm dialog's object, a toast.
 */
export function useValueText(): (
  value: unknown,
  descriptor: EntityFieldDescriptor,
) => string {
  const formatting = useCellFormatting();
  return useCallback(
    (value, descriptor) =>
      formatByType(
        value,
        descriptor.type,
        descriptor.linkLabelProperty,
        formatting(descriptor),
      ),
    [formatting],
  );
}

/**
 * A reference reads as its target's name, in every state the read can be in
 * ([ADR 0030](../../../../../../../docs/adr/0030-a-reference-names-its-target-through-the-owners-read-port.md)):
 * a skeleton while it resolves (the noun and short id for a screen reader); the name; the entity's noun and the short id,
 * muted, when no record answered or the read failed — never an alert, since a
 * list that loaded has not failed because one name could not be read; and the
 * raw id, muted, when the host registered nothing to read it with.
 */
export function ReferenceValue({ entity, id }: { entity: string; id: string }) {
  const state = useReferenceLabel(entity, id);
  const unresolved = useUnresolvedReference();
  const locale = useLocale();
  switch (state.status) {
    case 'resolving':
      // The skeleton is hidden from assistive tech, so the noun and short id
      // stand in for it there: a record's title link is never nameless.
      return (
        <>
          <Skeleton shape="line" className="w-16" />
          <span className="sr-only">{unresolved(entity, id)}</span>
        </>
      );
    case 'named': {
      const { label } = state;
      if (typeof label === 'string') return <span>{label}</span>;
      const text = localize(label, locale);
      return (label[locale] ?? '') === '' ? (
        <span lang={defaultLocale()}>{text}</span>
      ) : (
        <span>{text}</span>
      );
    }
    case 'unregistered':
      return <span className="text-content-muted">{id}</span>;
    default:
      return (
        <span className="text-content-muted">{unresolved(entity, id)}</span>
      );
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
   * member of the record (`money.currencyMember`), and a scaled member whose
   * unit is (`scaled.unitMember`), read it from here.
   */
  record?: Readonly<Record<string, unknown>>;
}

/**
 * Renders one entity member according to its metadata type. Centralizing this
 * is what lets a table stay generic: a link, a date and a number all arrive as
 * "the value of an accessor", and only the descriptor decides how they read.
 */
export function CellValue({ value, descriptor, record }: CellValueProps) {
  const formatting = useCellFormatting();
  const locale = useLocale();
  const unitLabel = useUnitLabel();

  if (
    value === undefined ||
    value === null ||
    value === '' ||
    // An empty list of values reads as empty, not as a blank cell. Rows
    // still read as their count: "0 rows" is information.
    (descriptor.type === 'scalarCollection' &&
      Array.isArray(value) &&
      value.length === 0)
  ) {
    return <span className="text-content-muted">{EMPTY}</span>;
  }

  // A list of keys into another entity reads as those records' names, one
  // per element, in the order held.
  if (descriptor.references !== undefined && Array.isArray(value)) {
    const { entity } = descriptor.references;
    return (
      <span>
        {value.map((id, index) => (
          <span key={`${index}-${String(id)}`}>
            {index > 0 && ', '}
            <ReferenceValue entity={entity} id={String(id)} />
          </span>
        ))}
      </span>
    );
  }

  // A key into another entity reads as that record's name, never as itself.
  if (descriptor.references !== undefined) {
    return (
      <ReferenceValue
        entity={descriptor.references.entity}
        id={String(value)}
      />
    );
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

  // A scaled integer reads as the decimal it stands for, beside its unit. One
  // whose record names no declared unit stays the number it is, as money
  // without a currency does.
  if (descriptor.scaled !== undefined) {
    const stored = Number(value);
    const resolved = scaleOf(descriptor.scaled, record);
    if (resolved !== undefined && Number.isSafeInteger(stored)) {
      return (
        <ScaledValue
          value={stored}
          scale={resolved.scale}
          unit={unitLabel(descriptor.scaled, resolved.unit)}
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
    formatting(descriptor),
  );

  if (text === '') {
    return <span className="text-content-muted">{EMPTY}</span>;
  }

  // A status reads as a tag in its declared tone, its words beside the
  // colour; a value given no tone reads neutral. An enum that declared no
  // tones is not a status, and stays text.
  if (descriptor.type === 'enum' && descriptor.enumTones !== undefined) {
    return (
      <StatusTag tone={descriptor.enumTones[String(value)] ?? 'neutral'}>
        {text}
      </StatusTag>
    );
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
