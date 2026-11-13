'use client';

import {
  cloneEntityDraft,
  describeEntityColumns,
  type Entity,
  type EntityAction,
  type EntityDraft,
  type EntityDraftValue,
  type EntityLinkSource,
  extractMetaEntity,
  type MetaAccessorType,
  readDraftString,
  readLocalizedDraft,
  readRowDrafts,
  type UseCaseDescriptor,
} from '@entifix/core';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import {
  useEntityNoun,
  useLocalizedDescriptors,
  useT,
  useTranslateKey,
} from '../../../i18n/index.js';
import {
  availableUseCases,
  renderAnchor,
  useCasesForSurface,
} from '../../actions/index.js';
import { useVerbInvoker } from '../../actions/use-verb-invoker.js';
import { Button, button } from '../../atoms/button/index.js';
import { CellValue } from '../../atoms/cell-value/index.js';
import { FieldControl } from '../../atoms/field-control/index.js';
import { LocalizedFieldControl } from '../../atoms/localized-field-control/index.js';
import { Skeleton } from '../../atoms/skeleton/index.js';
import { Text } from '../../atoms/text/index.js';
import {
  ActionBar,
  type ActionBarItem,
  itemsForUseCases,
} from '../../molecules/action-bar/index.js';
import { Card } from '../../molecules/card/index.js';
import { EntityLinkInput } from '../../molecules/entity-link-input/index.js';
import { LoadingBoundary } from '../../molecules/loading-boundary/index.js';
import { RegionState } from '../../molecules/region-state/index.js';
import { Stack } from '../../molecules/stack/index.js';
import { cn } from '../../utils/cn.js';
import { useLiveUpdates } from '../../utils/live-updates.js';
import {
  useFocusOnArrival,
  useFocusOnLoss,
} from '../../utils/use-focus-on-arrival.js';
import { EntityDetailGrid } from '../entity-detail-grid/index.js';
import type {
  EntityFormField,
  EntityFormMode,
  EntityFormProps,
} from './entity-form.types.js';
import { readEntityFormFields } from './entity-form-slots.js';
import { resolveEntityFormFields } from './use-entity-form-fields.js';

/**
 * The member types a `linkSources` entry can actually produce an editor for.
 *
 * `link` is the obvious one. `string` is here because a foreign key does not
 * have to be a typed relation: when the target lives in **another slice's
 * store**, an `EntityLink` would be an illegal edge and a storage-layer join
 * across a store boundary, so the member is a plain id and the relation exists
 * only in the operator's head — a cross-store reference is an id, never a
 * link. Nothing about the editor cares which of the two it is —
 * `EntityLinkInput` writes `String(target.id)` into the draft either way, and
 * the *only* place `link`-ness still matters is `applyEntityLinks` at submit,
 * which skips a non-`link` descriptor and so leaves the id as the truth.
 *
 * Everything else is excluded on purpose rather than by omission: a `boolean`,
 * `enum`, `number` or `date` member cannot name another record, so a source
 * pointed at one is a wiring mistake — see {@link assertLinkSourcesAreEditable}.
 */
const PICKABLE_TYPES: ReadonlySet<MetaAccessorType> = new Set<MetaAccessorType>(
  ['link', 'string'],
);

/**
 * A form that builds itself from an entity's metadata: fields, labels and value
 * formatting all come from `@accessor()` declarations, so editing a new entity
 * needs no bespoke form. The read/edit toggle is the whole point — the same
 * component shows a record as text or as inputs.
 *
 * Two things layer on top of that default:
 * - **modes** — `read` renders each member through `CellValue`; `edit` renders
 *   the matching `FieldControl`. A member in {@link PICKABLE_TYPES} with an
 *   entry in `linkSources` gets the full picker instead — a to-one `link`, or a
 *   `string` holding a foreign key into another slice's store. Without a source,
 *   a relation stays read-only, and a `linkCollection` always does, the to-many
 *   editor being a follow-up. A source aimed at a member that can render no
 *   picker is a wiring mistake rather than a no-op, and throws.
 * - **slots** — `<EntityField>` children override one field's label, control or
 *   read display, or add a computed field.
 *
 * It is presentational: the draft, its errors and the save/delete actions are
 * all props, so the same form hosts on a plain route and inside a workspace tab.
 */
/** The key the built-in Delete runs under, which no declared verb can take. */
const DELETE_KEY = '$delete';

/** Save, from anywhere in the form — the caret in a field included. */
const SAVE_SHORTCUT = 'Mod+S';
/** The footer's declared primary, when it is not Save. */
const PRIMARY_SHORTCUT = 'Mod+Enter';

export function EntityForm<TEntity extends Entity>({
  entityConstructor,
  entity,
  values,
  onFieldChange,
  linkSources,
  onLinkChange,
  mode: modeProp,
  defaultMode,
  onModeChange,
  errors,
  formError,
  onSubmit,
  onDelete,
  deletePolicy = 'confirm',
  recordLabel: hostRecordLabel,
  embedded = false,
  isLoading = false,
  skeleton = true,
  isSaving = false,
  isPending = false,
  isDeleting = false,
  error,
  onRetry,
  backHref,
  renderLink = renderAnchor,
  title,
  metadata,
  isMetadataLoading = false,
  onUseCase,
  onClone,
  children,
}: EntityFormProps<TEntity>) {
  const formId = useId();
  const slots = readEntityFormFields<TEntity>(children);
  // The *field* descriptors, which stay local and synchronous — a column is a
  // property of the class every caller holds. Only an action's availability is
  // a property of the caller, which is why that half arrives as `metadata`.
  const columnDescriptors = describeEntityColumns(
    entityConstructor,
    entity,
  ) as Array<EntityFormField<TEntity>>;
  // Before slots resolve, so an `<EntityField label>` override still wins.
  const described = useLocalizedDescriptors(columnDescriptors);
  const resolved = resolveEntityFormFields(described, slots.fields);
  assertLinkSourcesAreEditable(resolved, linkSources);

  // **Form above, table below**, and it is a partition rather than an ordering
  // hint. A grid rendered between two labelled inputs reads as a field, which
  // it is not — it is a second record list — so every owned collection is
  // pulled out of the field stack whatever `order` it declared, and rendered
  // full width beneath it. A composition that named no child has nothing to
  // render and stays where it was, showing its row count as before.
  const fields = resolved.filter(field => !isOwnedCollection(field));
  const ownedCollections = resolved.filter(isOwnedCollection);

  /**
   * `true`/omitted → the built-in default, which draws one label+control pair
   * per resolved field; a node → that node; `false` → nothing. The field list
   * comes from the constructor's metadata, not from the record, so it is already
   * complete while the record is still in flight — which is what lets the
   * placeholder match the form it is standing in for.
   */
  const customSkeleton = typeof skeleton === 'boolean' ? undefined : skeleton;
  const showSkeleton = isLoading && skeleton !== false;

  const [internalMode, setInternalMode] = useState<EntityFormMode>(
    defaultMode ?? (entity ? 'read' : 'edit'),
  );
  const mode = modeProp ?? internalMode;
  const editing = mode === 'edit';

  const draft: EntityDraft = values ?? {};
  const setField = (name: string, value: EntityDraftValue) =>
    onFieldChange?.(name, value);

  const toggleMode = () => {
    const next: EntityFormMode = editing ? 'read' : 'edit';
    setInternalMode(next);
    onModeChange?.(next);
  };

  const t = useT();
  const translateKey = useTranslateKey();
  const entityNoun = useEntityNoun();
  const live = useLiveUpdates();
  // A form reached by a write — saved, handed off by a wizard — takes focus on
  // its heading, so it never rests on `<body>` (ADR 0028).
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(heading);
  const busy = isSaving || isPending || isDeleting;

  // A draft restored from storage holds relation ids and no instances, so every
  // picker is resolving its target for a moment after mount. Saving inside that
  // window is exactly the case `applyEntityLinks` refuses: an `embedded` member
  // with an id and nothing to inline. Gating the save is the honest answer —
  // the form is still assembling itself, and the wait is one lookup long.
  //
  // Deliberately not narrowed to `embedded` members: a descriptor's
  // serialization is not what makes an in-flight lookup a bad moment to submit,
  // and a form that saves half-resolved is confusing whichever shape it writes.
  const resolvingLinks = Object.values(linkSources ?? {}).some(
    source => source.selected.isLoading,
  );

  // Absent metadata keeps the pre-ADR-0026 behaviour, so an un-migrated call
  // site renders exactly as before. Present metadata is authoritative: it is
  // what the service already decided this caller may do.
  const may = (action: EntityAction) =>
    metadata === undefined || metadata.actions.includes(action);

  // A single-record form shows the verbs that act on *this* record. Which cell
  // lands where is `action-surfaces`' business and nobody else's — a
  // `context-dependent` entity verb belongs to a row's overflow menu and a
  // `collection`-bound one to the bulk bar, and resolving that here as well is
  // how the two surfaces drifted apart in the first place.
  //
  // ⚠️ **Only when there is somewhere for them to go.** Every cell these two
  // surfaces render is `binding: 'entity'`, so without an `onUseCase` the
  // button has no handler and clicking it does nothing at all. That is not a
  // hypothetical: `makeEntityCrud` withholds the handler on a create, because
  // there is no record for a verb to act on — and Publish and Unpublish
  // rendered on a new `ProductOffering` and were inert, which reads as a broken
  // feature rather than an inapplicable one.
  //
  // The hooks are called unconditionally and their *results* are gated: React's
  // hook count must stay fixed across renders.
  const declaredHeaderUseCases = useCasesForSurface(
    'form-header',
    metadata?.useCases,
  );
  const declaredFooterUseCases = useCasesForSurface(
    'form-footer',
    metadata?.useCases,
  );
  // And only the verbs the record's state allows: a shipment awaiting dispatch
  // offers Dispatch, not every move a shipment can ever make.
  const headerUseCases = onUseCase
    ? availableUseCases(declaredHeaderUseCases, entity)
    : [];
  const footerUseCases = onUseCase
    ? availableUseCases(declaredFooterUseCases, entity)
    : [];
  // A verb that moved its record out of the states it applies to unmounts the
  // button the reader just pressed; focus goes to the heading, not `<body>`.
  useFocusOnLoss(
    () => heading.current,
    [...headerUseCases, ...footerUseCases].map(({ key }) => key).join(' '),
  );

  // Every verb on the form, and its own Delete, goes through one invoker: a
  // destructive verb asks, asks for the name, or runs and offers Undo, as it
  // declared — `revoke-sessions` ends every session a user holds.
  const verbs = useVerbInvoker<undefined>({
    run: key => (key === DELETE_KEY ? onDelete?.() : onUseCase?.(key)),
    busy,
    served: metadata?.useCases,
  });
  // What a confirmation names: the record as the reader knows it — its first
  // filled-in field — or, for a record with nothing filled in, the entity.
  const metaEntity = extractMetaEntity(entityConstructor);
  const named = fields.find(
    field => field.type !== 'id' && readDraftString(draft, field.name) !== '',
  );
  const recordLabel =
    hostRecordLabel ??
    (named === undefined
      ? entityNoun(metaEntity)
      : readDraftString(draft, named.name));
  const invoke = (descriptor: UseCaseDescriptor) =>
    verbs.invoke({
      descriptor,
      target: undefined,
      object: recordLabel,
      count: 1,
    });
  const requestDelete = () => {
    // Undo is the host's to offer: only it can put a deleted record back.
    if (deletePolicy === 'undo') {
      onDelete?.();
      return;
    }
    invoke({
      key: DELETE_KEY,
      binding: 'entity',
      placement: 'determining',
      labelKey: 'controls:form.delete',
      confirm: {
        tone: 'destructive',
        messageKey: 'controls:confirm.deleteMessage',
      },
      reversible: deletePolicy,
    });
  };

  const headerItems = itemsForUseCases(
    headerUseCases,
    translateKey,
    invoke,
    busy,
  );
  const footerItems = itemsForUseCases(
    footerUseCases,
    translateKey,
    invoke,
    busy,
  );
  /**
   * A save attempt. Counted, so a refused one moves focus to the error summary
   * once — not again on every keystroke that leaves an error standing.
   */
  const [attempt, setAttempt] = useState(0);
  const save = () => {
    setAttempt(current => current + 1);
    onSubmit?.(draft);
  };
  const summary = useRef<HTMLDivElement>(null);
  const summaryId = useId();
  const invalid = editing
    ? fields.filter(field => errors?.[field.name] !== undefined)
    : [];
  const focusedAttempt = useRef(0);
  useEffect(() => {
    if (attempt === focusedAttempt.current || invalid.length === 0) return;
    focusedAttempt.current = attempt;
    summary.current?.focus();
  }, [attempt, invalid.length]);

  // Save is the footer's primary unless the entity declared one of its own — a
  // determining "Publish" is what that page is for, and Save steps aside.
  const declaresFooterPrimary = footerItems.some(
    item => item.emphasis === 'primary',
  );
  const footerActions: ActionBarItem[] = [
    ...(may('write')
      ? [
          {
            key: 'save',
            // A pending write waits on the push stream; while that is down
            // it says so, rather than waiting without a word.
            label: isPending
              ? t(live.connection === 'open' ? 'form.pending' : 'live.waiting')
              : isSaving
                ? t('form.saving')
                : t('form.save'),
            emphasis: declaresFooterPrimary
              ? ('default' as const)
              : ('primary' as const),
            disabled: busy || resolvingLinks,
            submit: true,
            shortcut: SAVE_SHORTCUT,
            onSelect: save,
          },
        ]
      : []),
    // The page's main act answers Mod+Enter, unless it declared its own.
    ...footerItems.map(item =>
      item.emphasis === 'primary' && item.shortcut === undefined
        ? { ...item, shortcut: PRIMARY_SHORTCUT }
        : item,
    ),
    // Clone is the CRUD triple's, not a declared verb's: every entity can be
    // copied, so giving it a `@useCase()` would mean declaring the same verb on
    // all 28 of them. It needs `write`, because what it produces is a create.
    ...(onClone && entity && may('write')
      ? [
          {
            key: 'clone',
            label: t('form.clone'),
            disabled: busy,
            onSelect: () => onClone(cloneEntityDraft(entityConstructor, draft)),
          },
        ]
      : []),
    ...(onDelete && may('delete')
      ? [
          {
            key: 'delete',
            label: isDeleting ? t('form.deleting') : t('form.delete'),
            destructive: true,
            disabled: busy,
            onSelect: requestDelete,
          },
        ]
      : []),
  ];

  // A real form while editing, so Enter in a field saves; an embedded one
  // belongs to its host's flow, and a caller who may not write has no Save.
  const asForm = editing && !embedded && may('write');
  const rows = fields.map(field => (
    <FieldRow
      key={field.name}
      field={field}
      entity={entity}
      draft={draft}
      value={readDraftString(draft, field.name)}
      editing={editing}
      error={editing ? errors?.[field.name] : undefined}
      setField={setField}
      linkSource={linkSources?.[field.name]}
      onLinkChange={onLinkChange}
      id={`${formId}-${field.name}`}
    />
  ));

  const body = (
    <Stack gap="s">
      {/* An embedded form brings only its fields: the heading and the action
            row belong to whatever is hosting it — a wizard step sits under the
            wizard's own heading and advances with the wizard's own footer, so
            rendering a second of each is two controls for one job. */}
      {!embedded && (
        <Stack direction="row" gap="xs" align="center">
          <Text
            as="h2"
            ref={heading}
            tabIndex={-1}
            step={1}
            weight="semibold"
            className="focus-ring"
          >
            {/* `entity` is undefined while the record is still in flight, so
                testing it alone made a loading edit form announce itself as
                "New" for as long as the fetch took, then relabel when the
                record landed. A form that is loading is never a create. */}
            {title ?? (entity || isLoading ? t('form.details') : t('form.new'))}
          </Text>
          {/* The built-in toggle only appears when the form owns its mode and
              there is a record to view — a create form has nothing to read. */}
          {modeProp === undefined && entity && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={toggleMode}
            >
              {editing ? t('form.view') : t('form.edit')}
            </Button>
          )}
          <LoadingBoundary isLoading={isMetadataLoading} lines={0}>
            <>
              {headerItems.length > 0 && (
                <ActionBar surface="form-header" items={headerItems} />
              )}
              {slots.headerActions}
            </>
          </LoadingBoundary>
        </Stack>
      )}

      {/* One announcement for the form; the shimmer below is aria-hidden. */}
      <span role="status" aria-live="polite" className="sr-only">
        {isLoading ? t('form.loading') : ''}
      </span>

      <RegionState
        plural={entityNoun(metaEntity, 'plural')}
        error={error}
        onRetry={onRetry}
        // Only a load that can be retried leaves an out-of-date record; a
        // failed save leaves what the reader typed, which is current.
        hasStaleData={entity !== undefined && onRetry !== undefined}
      />

      {/* A refused save, as one summary of links to what needs fixing: the
            only alert in the form, and where focus goes after the attempt. */}
      {invalid.length > 0 && (
        <div
          ref={summary}
          tabIndex={-1}
          role="alert"
          aria-labelledby={summaryId}
          data-testid="entity-form-error-summary"
          className="rounded-lg border-l-4 border-danger bg-danger-subtle px-s py-xs text-step-sm text-content focus-ring"
        >
          <p id={summaryId} className="m-0 font-semibold">
            {t('form.errorSummary', { count: invalid.length })}
          </p>
          <ul className="m-0 ps-s">
            {invalid.map(field => (
              <li key={field.name}>
                <a
                  href={`#${formId}-${field.name}`}
                  // The content colour: primary on the danger surface misses
                  // 4.5:1.
                  className="font-medium text-content underline underline-offset-2 focus-ring"
                  onClick={event => {
                    event.preventDefault();
                    document.getElementById(`${formId}-${field.name}`)?.focus();
                  }}
                >
                  {errors?.[field.name]}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && fields.some(field => field.required && !field.readonly) && (
        <Text step={-1} tone="muted">
          {t('form.requiredHint')}
        </Text>
      )}

      {/* The placeholder *replaces* the rows rather than sitting above them.
            Rendering both meant a shimmer stacked on a full set of empty fields,
            which is two loading signals for one region and twice the height the
            loaded form settles at. */}
      {showSkeleton
        ? (customSkeleton ??
          fields.map(field => (
            <Stack key={field.name} gap="3xs">
              <Skeleton shape="line" className="w-24" />
              <Skeleton className="h-9 w-full" />
            </Stack>
          )))
        : editing
          ? rows
          : // Read mode is a description list: a label points at nothing
            // when there is no control, and a term and its value is what
            // the pair is.
            rows.length > 0 && (
              <dl className="m-0 flex flex-col gap-s">{rows}</dl>
            )}

      {/* The rows the record owns, full width and below every field. Each
            grid is handed the *whole* error map and picks out the keys naming
            its own member, so a record owning two collections needs no
            bookkeeping here. */}
      {ownedCollections.map(field => (
        <EntityDetailGrid
          key={field.name}
          descriptor={field}
          rows={readRowDrafts(draft[field.name])}
          onRowsChange={rows => setField(field.name, rows)}
          errors={editing ? errors : undefined}
          editing={editing}
          isLoading={isLoading}
          skeleton={skeleton}
        />
      ))}

      {/* A cross-field rule has no row to sit under, so it sits with the
            actions it blocks. */}
      {editing && formError && (
        <span role="alert" className="text-step-sm text-danger">
          {formError}
        </span>
      )}

      {editing && !embedded && (
        <Stack direction="row" gap="xs" align="center">
          <ActionBar surface="form-footer" size="md" items={footerActions} />
          {slots.footerActions}
          {/* A link styled as a button, not a button inside a link: the old
                nesting was two interactive elements for one action, and its
                `disabled` stopped nothing, because the anchor around it still
                navigated. While busy the link is inert instead. */}
          {backHref &&
            renderLink({
              href: backHref,
              className: cn(
                button({ variant: 'ghost' }),
                busy && 'pointer-events-none opacity-50',
              ),
              children: t('form.back'),
              intent: { kind: 'back' },
            })}
        </Stack>
      )}

      {slots.rest}
    </Stack>
  );

  return (
    <Card>
      {asForm ? (
        <form
          noValidate
          // Enter submits through Save, the form's default button, which is
          // disabled while a save is in flight — so a busy form stays put.
          onSubmit={event => {
            event.preventDefault();
            save();
          }}
        >
          {body}
        </form>
      ) : (
        body
      )}

      {verbs.dialog}
    </Card>
  );
}

/**
 * A member the detail grid renders rather than the field stack.
 *
 * The `childType` half is not defensive: a `composition` that declared no child
 * has no columns, so there is nothing for a grid to draw. It keeps its place in
 * the field stack and reads as its row count, which is what it did before this
 * control existed — an honest "some rows" rather than an empty table implying
 * there are none.
 */
function isOwnedCollection<TEntity extends Entity>(
  field: EntityFormField<TEntity>,
): boolean {
  return field.type === 'composition' && field.childType !== undefined;
}

/**
 * Refuse a `linkSources` entry that names a member no picker can be built for.
 *
 * `FieldRow` asks for {@link PICKABLE_TYPES} before it builds an editor, so a
 * source handed to anything else used to fall through to the read-only display
 * or a plain `FieldControl` with nothing said: the caller wired a picker, no
 * picker appeared, and the field was indistinguishable from one the entity had
 * declared read-only. That is a wiring mistake rather than a state — the entry
 * is dead in *every* shape such a field can render, since an
 * `<EntityField render>` slot is handed the draft and never the source — so it
 * costs the render instead of a warning nobody reads. `useEntityLinkSource`
 * already throws at render for the sibling mistake (a search
 * property the target does not declare `filterable`); this is the same fault
 * caught one level up.
 *
 * Two messages, because the two faults are not the same thing. A
 * `linkCollection` is a member the editor has simply not been built for yet
 * (#26), so the fix is to wait or to point at the to-one you meant. Any other
 * type is a member that can never name another record at all, so the fix is to
 * remove the entry.
 *
 * Here rather than inside `FieldRow`, and that is the whole reason it is a
 * separate pass: a row only reaches its editor branch in **edit** mode, so a
 * per-row check would stay silent on a form that opens in `read` — the default
 * whenever there is a record — and then throw on a click, minutes later. One
 * pass over the registry fires on the first render either way.
 *
 * Against the resolved fields rather than the raw metadata: a slot may drop a
 * member, and a source left behind for a field that no longer renders is not
 * worth a page.
 */
function assertLinkSourcesAreEditable<TEntity extends Entity>(
  fields: Array<EntityFormField<TEntity>>,
  // Same reason as the prop's own declaration: a source's target is another
  // entity entirely and cannot be expressed in terms of `TEntity`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  linkSources: Record<string, EntityLinkSource<any>> | undefined,
): void {
  if (linkSources === undefined) return;

  const sourced = fields.filter(
    field =>
      linkSources[field.name] !== undefined && !PICKABLE_TYPES.has(field.type),
  );
  if (sourced.length === 0) return;

  const toMany = sourced
    .filter(field => field.type === 'linkCollection')
    .map(field => field.name);
  if (toMany.length > 0) {
    throw new Error(
      `EntityForm was given a link source for a to-many member: ${toMany.join(', ')}. ` +
        'A `linkCollection` has no editor yet, so the source can only be dropped ' +
        'and the field would render read-only with no sign anything was wired. ' +
        'Remove the entry, or point it at the to-one `link` you meant.',
    );
  }

  const owned = sourced
    .filter(field => field.type === 'composition')
    .map(field => field.name);
  if (owned.length > 0) {
    throw new Error(
      `EntityForm was given a link source for an owned collection: ${owned.join(', ')}. ` +
        'A `composition` is not a reference — its rows have no life outside this ' +
        'record and are never picked from existing ones, so there is nothing for a ' +
        'picker to look up. The detail grid is what edits them.',
    );
  }

  const unpickable = sourced.map(field => `${field.name} (${field.type})`);
  throw new Error(
    `EntityForm was given a link source for a member that cannot hold one: ${unpickable.join(', ')}. ` +
      'A picker writes the target’s id into the draft, so the member has to be a ' +
      '`link` or the `string` that carries a foreign key. Remove the entry, or ' +
      'point it at the member that actually holds the reference.',
  );
}

interface FieldRowProps<TEntity extends Entity> {
  field: EntityFormField<TEntity>;
  entity: TEntity | undefined;
  draft: EntityDraft;
  value: string;
  editing: boolean;
  error: string | undefined;
  setField: (name: string, value: EntityDraftValue) => void;
  // The target of a relation is a different entity than the form's own.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  linkSource: EntityLinkSource<any> | undefined;
  onLinkChange:
    ((name: string, entity: Entity | undefined) => void) | undefined;
  id: string;
}

/**
 * One label + control (or value) row. A `readonly` member renders its read
 * display even in edit mode, and so does a relation with no source; everything
 * else edits through `FieldControl` — or, when a source was supplied for a
 * member in {@link PICKABLE_TYPES}, through `EntityLinkInput`. A boolean edited
 * inline carries its own label, so the row does not add a second one.
 *
 * The source branch sits above the `virtual || isRelation` fallback and below
 * `field.render`, which is what lets a slot still override a picked field.
 */
function FieldRow<TEntity extends Entity>({
  field,
  entity,
  draft,
  value,
  editing,
  error,
  setField,
  linkSource,
  onLinkChange,
  id,
}: FieldRowProps<TEntity>) {
  const t = useT();
  const errorId = `${id}-error`;
  const readNode: ReactNode = field.readRender ? (
    field.readRender(entity)
  ) : (
    <CellValue
      value={
        entity ? (entity as Record<string, unknown>)[field.name] : undefined
      }
      descriptor={field}
      record={entity as Record<string, unknown> | undefined}
    />
  );

  // Members with no editor of their own here: a to-one `link` whose picker was
  // never wired, a `linkCollection` (#26) and a `composition`. All three
  // fall back to the read display, which is honest — a disabled text box
  // holding `[object Object]` is not.
  const isRelation =
    field.type === 'link' ||
    field.type === 'linkCollection' ||
    field.type === 'composition';

  let control: ReactNode;
  if (!editing) {
    control = readNode;
  } else if (field.render) {
    control = field.render({ draft, value, setField, id });
  } else if (linkSource && PICKABLE_TYPES.has(field.type)) {
    control = (
      <EntityLinkInput
        descriptor={field}
        value={value}
        source={linkSource}
        id={id}
        disabled={field.readonly}
        onSelect={target => {
          setField(field.name, target.id == null ? '' : String(target.id));
          onLinkChange?.(field.name, target);
        }}
        onClear={() => {
          setField(field.name, '');
          onLinkChange?.(field.name, undefined);
        }}
      />
    );
  } else if (field.type === 'localized' && !field.virtual) {
    control = (
      <LocalizedFieldControl
        descriptor={field}
        value={readLocalizedDraft(draft, field.name)}
        onChange={next => setField(field.name, next)}
        id={id}
      />
    );
  } else if (field.virtual || isRelation) {
    // A relation with no source has no input to offer, and a virtual field has
    // no member to edit unless a `render` was supplied — both fall back to the
    // read display.
    control = readNode;
  } else {
    control = (
      <FieldControl
        descriptor={field}
        value={value}
        onChange={next => setField(field.name, next)}
        id={id}
        record={draft}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        aria-required={field.required || undefined}
      />
    );
  }

  if (!editing)
    return (
      <div className="flex flex-col gap-3xs">
        <dt className="text-step-sm text-content-muted">{field.label}</dt>
        <dd className="m-0">{control}</dd>
      </div>
    );

  const ownsLabel = field.type === 'boolean' && !field.render && !field.virtual;
  // Marked before anyone submits, not discovered after.
  const marked = field.required && !field.readonly;

  return (
    <Stack gap="3xs">
      {!ownsLabel && (
        // The marker sits beside the label, not in it: the name stays the
        // field's own, and `aria-required` is what says it to a reader.
        <span className="flex items-baseline gap-3xs">
          <label htmlFor={id} className="text-step-sm text-content-muted">
            {field.label}
          </label>
          {marked && (
            <span aria-hidden="true" className="text-step-sm text-danger">
              {t('form.requiredMarker')}
            </span>
          )}
        </span>
      )}
      {control}
      {/* Not an alert of its own: the summary above the fields is the one
          announcement, and this is what the control's description reads. */}
      {error && (
        <span id={errorId} className="text-step-sm text-danger">
          {error}
        </span>
      )}
    </Stack>
  );
}
