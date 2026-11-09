'use client';

import {
  deleteUCFactory,
  type EntityFacetCounterTag,
  EntityIdTag,
  type EntityRepositoryTag,
  EntityTag,
  getUCFactory,
  loadUCFactory,
  saveUCFactory,
} from '@entifix/business';
import {
  coerceFiltering,
  describeEntityColumns,
  type EntifixFailure,
  type Entity,
  type EntityConstructor,
  type EntityId,
  type EntityMetadataSource,
  type EntitySelection,
  type EntityUseCaseRunner,
  type EntityWriter,
  envelopeEntityName,
  extractMetaEntity,
  type FilterGroup,
  Internal,
  isFailure,
  parseRsql,
  serializeRsql,
  settled,
  type UseCaseDescriptor,
} from '@entifix/core';
import {
  EntityTable,
  useCasesForSurface,
  useFocusOnArrival,
  useT,
  useToasts,
} from '@entifix/react-controls';
import {
  entityQueryScope,
  type OptimisticMutation,
  useDataLoading,
  useEntityRecord,
  useFacetCounts,
  useOptimisticMutation,
} from '@entifix/react-integration';
import { useQueryClient } from '@tanstack/react-query';
import { Cause, Context, Effect, Exit } from 'effect';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { useLocaleHref } from '../i18n/index.js';
import { useEntityNavHost } from '../workspace/entity-nav.js';
import { EntityCrudForm } from './entity-crud-form.js';
import type {
  AnyFilterGroup,
  EntityCrud,
  EntityCrudLinkSource,
  EntityCrudOptions,
  EntityCrudSingleViewProps,
} from './make-entity-crud.types.js';
import { CATALOG_NEW_SLUG, slugToEntityId } from './slug.js';
import { useCrudRenderLink } from './use-crud-render-link.js';
import { useEntityAffordances } from './use-entity-affordances.js';
import { useEntityBulk } from './use-entity-bulk.js';

/** What a picker defaults to reading off its target. */
const TARGET_NAME_PROPERTY = 'name';

/**
 * What the generated pages' use-cases run against: one repository adapter.
 * Exported because a hand-built screen — a wizard reading records and
 * resolving pickers — runs against exactly the same.
 */
export type CrudContext = EntityRepositoryTag;

/**
 * One repository adapter, by its key, as the context the use-cases run
 * against.
 *
 * The cast is the price of naming adapters by key: `AdapterKey` narrows which
 * names may be *offered*, but TypeScript will not carry that narrowing through
 * an index access on a generic record.
 */
export function crudContextOf<TAdapters>(
  adapters: TAdapters,
  repository: keyof TAdapters,
): Context.Context<CrudContext> {
  return adapters[repository] as Context.Context<EntityRepositoryTag>;
}

/**
 * Builds the list page and the single-record page for one entity.
 *
 * Every catalog entity used to cost ~10 files and ~300 lines whose only variable
 * was a class name: two organisms with a `.types.ts` each, two client pages, two
 * route files. The route files stay (Next needs a module per path); everything
 * between them is derived from the entity's own metadata, so a new reference
 * entity is this call plus a nav entry.
 *
 * Two things are checked here rather than at the call site, because both fail
 * silently otherwise. The catalog key must be the entity's own `@entity({ key })`
 * — they are the same string by convention, and a drifted one titles the form
 * after a different entity in a way only a reader of both catalogs would catch.
 * And a `links` entry must name a real member — a picker aimed at nothing renders
 * identically to a read-only field.
 *
 * **Serves compile-time `@entity()` classes only.** Operator reference data ships
 * with the code, so making this spec-driven would trade type safety for nothing;
 * a vendor-authored `EntitySpecification` renders through a separate path.
 */
/**
 * A rejected write, as something the form's error slot can render.
 *
 * A typed failure is kept as it is: `useErrorMessage` translates its own code,
 * a business refusal and an outage alike. Anything else is a bug that reached
 * the screen, and is shown as `Internal` — never with its own text, which
 * nobody wrote for a user.
 */
function asFailure(failure: unknown): EntifixFailure {
  return isFailure(failure) ? failure : new Internal();
}

/**
 * What a write failed with *synchronously* — before any flow took it — or
 * `undefined`. A flow's own failure is toasted by the `PendingFlowsProvider`
 * that settles it, so showing it in the error slot too would tell the operator
 * twice.
 */
function syncFailure(
  mutation: OptimisticMutation<never, unknown>,
): EntifixFailure | undefined {
  return mutation.status === 'failed' && mutation.flowId === undefined
    ? asFailure(mutation.failure)
    : undefined;
}

/**
 * A runner's verbs, looked up by the key the served `$metadata` named. A
 * single verb answers either settle mode, so it is run through the optimistic
 * API; a bulk run reports per row and is awaited as a promise whose rejection
 * carries the failure itself.
 */
function verbsOf(
  runner: EntityUseCaseRunner | undefined,
  served: readonly UseCaseDescriptor[] | undefined,
) {
  if (runner === undefined) return undefined;
  // The key always comes from the served document, so it names a verb in it.
  const descriptor = (key: string) =>
    served?.find(candidate => candidate.key === key) as UseCaseDescriptor;
  return {
    run: (key: string, id: EntityId) => runner.run(descriptor(key), id),
    bulk: (key: string, selection: EntitySelection<Entity>) =>
      Effect.runPromiseExit(runner.bulk(descriptor(key), selection)).then(
        exit =>
          Exit.isSuccess(exit)
            ? exit.value
            : Promise.reject(Cause.squash(exit.cause)),
      ),
  };
}

type Verbs = NonNullable<ReturnType<typeof verbsOf>>;

/**
 * One verb on one record, through the optimistic API: `done` runs once the
 * verb took effect — at once when it settled, or when the flow it was handed
 * to completed.
 */
function useVerb(verbs: Verbs | undefined, done: () => void) {
  const verb = useOptimisticMutation<
    { readonly key: string; readonly id: EntityId },
    unknown
  >({
    // Only ever sent from a handler that exists because `verbs` does.
    write: ({ key, id }) => (verbs as Verbs).run(key, id),
    confirm: done,
  });
  const run = (key: string, id: EntityId) => {
    void verb.mutate({ key, id }).then(
      result => {
        if (result._tag === 'settled') done();
      },
      // Shown through `syncFailure`, from the mutation's own state.
      () => undefined,
    );
  };
  return { verb, run };
}

/** Whether the component is still mounted: a flow can settle after it left. */
function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/**
 * Runs each link's `useBaseFiltering` against the record being edited, in link
 * order, with `undefined` for a link that declares none.
 *
 * Legal for the reason `useEntityLinkSources` gives: the links are a
 * factory-time array, and whether a link carries a rule is fixed with it, so
 * the same hooks run in the same order on every render. The lint rule cannot
 * see a hook called through a member, so there is nothing for it to flag.
 */
function useLinkFilters<TEntity extends Entity>(
  links: readonly {
    readonly useBaseFiltering?: (
      record: TEntity | undefined,
    ) => AnyFilterGroup | undefined;
  }[],
  record: TEntity | undefined,
): (AnyFilterGroup | undefined)[] {
  return links.map(link => link.useBaseFiltering?.(record));
}

export function makeEntityCrud<TEntity extends Entity, TAdapters>(
  entityConstructor: EntityConstructor<TEntity>,
  options: EntityCrudOptions<TAdapters, TEntity>,
): EntityCrud<TEntity> {
  const {
    useAdapters,
    basePath,
    catalogKey,
    repository,
    hiddenFields = [],
    columns,
    toolbar,
    pageSize,
    initialFiltering,
    links = [],
    metadataSource: givenMetadataSource,
    metadata,
    useCases,
    write,
    delete: deletePolicy = 'confirm',
    facets,
  } = options;

  if (givenMetadataSource !== undefined && metadata !== undefined) {
    throw new Error(
      `${entityConstructor.name} was given both metadataSource and metadata; pass one`,
    );
  }
  // An adapter value, so it is resolved per render from the same `useAdapters()`
  // the records come from — the host's composition, never the caller's module.
  const metadataSourceOf = (adapters: TAdapters) =>
    metadata === undefined
      ? givenMetadataSource
      : (adapters[metadata] as EntityMetadataSource);

  // Through the service's own trust boundary rather than a second walk of the
  // tree: serialized the way a load request carries it, then coerced against
  // the entity's `filterable` allowlist exactly as a service coerces a query.
  // Whatever would answer `400` on the wire throws here instead, when the
  // screen is generated, naming the member.
  // An emptied group serializes to nothing and filters nothing, so there is
  // nothing to check.
  const initialRsql =
    initialFiltering === undefined ? '' : serializeRsql([initialFiltering]);
  if (initialRsql !== '') {
    coerceFiltering(entityConstructor, parseRsql(initialRsql));
  }

  const meta = extractMetaEntity(entityConstructor);
  if (meta.key !== catalogKey) {
    throw new Error(
      `${entityConstructor.name} declares key "${String(meta.key)}" but was given catalog key "${catalogKey}"`,
    );
  }
  // Read off `@entity()` rather than rebuilt from `catalogKey`. Both spellings
  // produce the same string today, and that is exactly the problem: a second
  // place that knows how an entity's catalog subtree is laid out is a second
  // place to fix when one moves. `MetaEntityOptions` makes them optional, so an
  // entity that never declared them fails here — where a screen is generated —
  // rather than on the render that first tries to title a tab with `undefined`.
  const { labelKey: entityLabelKey, pluralKey: entityPluralKey } = meta;
  if (entityLabelKey === undefined || entityPluralKey === undefined) {
    throw new Error(
      `${entityConstructor.name} must declare labelKey and pluralKey on @entity() to be generated`,
    );
  }
  // Narrowed once, for the closures below that TypeScript cannot follow.
  const labelKey: string = entityLabelKey;
  const pluralKey: string = entityPluralKey;

  // Computed once: a descriptor is a property of the class, so nothing about it
  // depends on the record being edited. `linkLabelProperty`/`linkSearchProperty`
  // are overridden here because a scalar foreign key's `@accessor()` cannot name
  // the target's members — it may not import the target at all.
  // The wire name, which is also what a pending flow's intent records and what
  // `entityQueryScopeFor` keys on — one derivation, so the two can never
  // disagree about which entity they mean.
  const entityName = envelopeEntityName(entityConstructor);
  const descriptors = describeEntityColumns(entityConstructor);
  /** The members a filter panel offers choices for, and so counts. */
  const facetMembers = descriptors
    .filter(
      descriptor =>
        descriptor.filterable &&
        (descriptor.type === 'enum' || descriptor.type === 'boolean'),
    )
    .map(({ name, key }) => ({ name, key }));
  /** A record as the reader knows it: its first shown member that is filled in. */
  const recordLabelOf = (record: TEntity | undefined): string | undefined => {
    const named = descriptors.find(descriptor => {
      if (descriptor.type === 'id' || hiddenFields.includes(descriptor.name))
        return false;
      const value = (record as Record<string, unknown> | undefined)?.[
        descriptor.name
      ];
      return value != null && String(value) !== '';
    });
    return named === undefined
      ? undefined
      : String((record as Record<string, unknown>)[named.name]);
  };
  const linkPlans = links.map(link => {
    const descriptor = descriptors.find(entry => entry.name === link.field);
    if (descriptor === undefined) {
      throw new Error(
        `${entityConstructor.name} has no member "${link.field}" for a link source`,
      );
    }
    return {
      ...link,
      descriptor: {
        ...descriptor,
        linkLabelProperty: link.labelProperty ?? TARGET_NAME_PROPERTY,
        linkSearchProperty: link.searchProperty ?? TARGET_NAME_PROPERTY,
      },
    };
  });

  function ListPage() {
    const adapters = useAdapters();
    // Every internal href carries the locale. An unprefixed one still resolves —
    // the middleware redirects it — but the visitor pays a round trip per click.
    const withLocale = useLocaleHref();

    const queryClient = useQueryClient();
    const scope = entityQueryScope(entityConstructor);
    const metadataSource = metadataSourceOf(adapters);
    const affordances = useEntityAffordances(entityConstructor, metadataSource);
    const renderLink = useCrudRenderLink(catalogKey);

    const pager = useDataLoading<TEntity, CrudContext>({
      uc: loadUCFactory<TEntity>(),
      ctx: crudContextOf(adapters, repository),
      // Scoped rather than left to the per-instance fallback, which is correct
      // but unshared: with the entity's own scope one invalidation refreshes
      // every page and filter of it, which is what a bulk run needs — and it is
      // the same prefix `useReactiveInvalidation`already targets, so a generated
      // list now also refreshes on a reactive change event.
      queryKey: scope,
      ...(pageSize === undefined ? {} : { initialPageSize: pageSize }),
      ...(initialFiltering === undefined ? {} : { initialFiltering }),
    });

    const facetCounts = useFacetCounts<TEntity>({
      ctx:
        facets === undefined
          ? undefined
          : (adapters[facets] as Context.Context<EntityFacetCounterTag>),
      members: facetMembers,
      filtering: pager.filtering,
      scope,
    });

    // Only when this caller may actually run something over a selection.
    //
    // Measured live: an `admin` holds `catalog-reference:*:read` and no
    // `retire`, so the service filters the verb out of `$metadata` — but the
    // selection column still rendered, offering a set that no action could be
    // taken on. A checkbox that can lead nowhere is worse than no checkbox: it
    // reads as a permission the user does not have.
    //
    // Decided from the served document rather than from the runner, because
    // the runner is a property of the *shell* (it knows the route) and the
    // grant is a property of the *caller*. The column therefore appears when
    // the document lands, which is the asynchrony serving affordances accepts
    // for every action surface.
    const canRunBulk =
      useCasesForSurface('bulk-bar', affordances.metadata?.useCases).length > 0;

    const verbs = verbsOf(
      useCases === undefined
        ? undefined
        : (adapters[useCases] as EntityUseCaseRunner),
      affordances.metadata?.useCases,
    );

    const bulk = useEntityBulk<TEntity>({
      run:
        canRunBulk && verbs !== undefined
          ? (key, selection) =>
              verbs.bulk(key, selection as EntitySelection<Entity>)
          : undefined,
      // A bulk write changed the rows underneath the listing, so the page is
      // re-read; the selection deliberately survives it ("the selection
      // is still there afterwards"), because the operator's next act is usually
      // to retry the failures or run a second verb on the same rows.
      onCompleted: () => {
        void queryClient.invalidateQueries({ queryKey: scope });
      },
    });

    // What a row's overflow menu runs, and the one place the list reports a
    // verb that failed.
    //
    // ⚠️ **A row verb and the form's are the same runner with different
    // arguments.** `EntityTable` hands back the whole record, because that is
    // what it has; the runner takes an id, because that is what a route needs.
    // The list has no error slot of its own, so a failure lands in the
    // table's own error region — the same one a failed page read uses.
    const rowVerb = useVerb(verbs, () => {
      void queryClient.invalidateQueries({ queryKey: scope });
    });
    // Called unconditionally and the *result* gated, the way the surfaces are
    // read in `EntityForm`: the name begins with `use`, so short-circuiting it
    // reads to `react-hooks/rules-of-hooks` as a conditional hook.
    const rowUseCases = useCasesForSurface(
      'row-menu',
      affordances.metadata?.useCases,
    );
    const canRunRowUseCase = verbs !== undefined && rowUseCases.length > 0;

    const handleRowUseCase = canRunRowUseCase
      ? (key: string, item: TEntity) => {
          if (item.id == null) return;
          rowVerb.run(key, item.id);
        }
      : undefined;

    // The list's heading, and where focus lands when a save or a delete
    // brings the reader back here rather than falling to `<body>`.
    const heading = useRef<HTMLHeadingElement>(null);
    useFocusOnArrival(heading);
    const et = useT('entity');

    return (
      <div className="flex flex-col gap-s">
        <h1
          ref={heading}
          tabIndex={-1}
          className="m-0 text-step-2 font-semibold text-content focus-ring"
        >
          {et(pluralKey.replace(/^entity:/, ''))}
        </h1>
        <EntityTable
          entityConstructor={entityConstructor}
          {...pager}
          items={pager.items}
          totalItems={pager.totalItems}
          hrefFor={id => withLocale(`${basePath}/${String(id)}`)}
          newHref={withLocale(`${basePath}/${CATALOG_NEW_SLUG}`)}
          renderLink={renderLink}
          {...affordances}
          {...bulk.tableProps}
          onUseCase={handleRowUseCase}
          onRetry={pager.refetch}
          facets={facetCounts}
          error={syncFailure(rowVerb.verb) ?? pager.error}
        >
          {columns}
          {toolbar}
        </EntityTable>
      </div>
    );
  }

  /**
   * Dual-host: as a route it reads its slug from the URL and returns to the list
   * on save; in a workspace tab it takes the slug and the post-save action as
   * props.
   */
  function SingleViewPage({
    slug,
    onSaved,
    onDeleted,
    draft,
  }: EntityCrudSingleViewProps = {}) {
    const adapters = useAdapters();
    const metadataSource = metadataSourceOf(adapters);
    // The same served document the form reads its buttons from, so a key the
    // form hands back always names a verb in it.
    const affordances = useEntityAffordances(entityConstructor, metadataSource);
    const router = useRouter();
    const withLocale = useLocaleHref();
    const params = useParams<{ slug: string }>();
    const mounted = useMounted();
    const id = slugToEntityId(slug ?? params.slug);

    const ctx = crudContextOf(adapters, repository);

    const {
      entity,
      isLoading,
      error: loadError,
      reload,
    } = useEntityRecord<TEntity, CrudContext>({
      uc: getUCFactory<TEntity>(),
      ctx,
      id,
    });

    // Against the record as loaded, not the draft: the rule is about which
    // record this is, not what the operator has typed into it.
    const linkFilters = useLinkFilters(linkPlans, entity);

    // Rebuilt inline on every render on purpose: `useEntityLinkSource` holds
    // these in a ref and keeps them out of its query keys, precisely so a caller
    // does not have to memoise them.
    const linkSources: EntityCrudLinkSource[] = linkPlans.map(
      (plan, index) => ({
        field: plan.field,
        descriptor: plan.descriptor,
        config: {
          entityConstructor: plan.entityConstructor,
          loadUc: loadUCFactory(),
          getUc: getUCFactory(),
          ctx: crudContextOf(adapters, plan.repository),
          // The config's target is erased to `Entity`, and the host's filter to
          // `any`; the two meet here, where neither type is the real target's.
          baseFiltering: linkFilters[index] as FilterGroup<Entity> | undefined,
        },
      }),
    );

    // Inside a workspace tab, "back to the list" is the list's tab, not a URL
    // that would leave the workspace. A host's own callbacks still win.
    const host = useEntityNavHost();
    const renderLink = useCrudRenderLink(catalogKey);
    const queryClient = useQueryClient();
    // The list this page returns to has its page cached, and it is no longer
    // true. Invalidated rather than patched: the service is the authority on
    // the row it stored.
    //
    // ⚠️ Invisible while every Open was a document load, which threw the cache
    // away anyway (#20): the first client-side navigation back to the list
    // showed the record as it was before the save.
    const refreshList = () =>
      queryClient.invalidateQueries({
        queryKey: entityQueryScope(entityConstructor),
      });
    const toList = () =>
      host === undefined
        ? router.push(withLocale(basePath))
        : host.toList(catalogKey);
    const afterSave = onSaved ?? toList;
    const afterDelete = onDeleted ?? toList;

    // Through the host's writer when it named one, which answers both settle
    // modes; otherwise through the repository, where every write settles.
    const writer =
      write === undefined ? undefined : (adapters[write] as EntityWriter);

    // The draft is spent once the write *commits*, and only here is that known:
    // `useEntityForm` neither fetches nor saves, so it cannot clear its own.
    // A failed write — or a failed flow — deliberately keeps the draft and the
    // form: the edit is still the user's only copy of what they typed.
    //
    // ⚠️ A flow can complete after the operator left this page, so leaving it
    // is guarded on still being here: a navigation from a form nobody is
    // looking at would pull them away from wherever they went.
    const saveMutation = useOptimisticMutation<TEntity, TEntity>({
      write: next =>
        writer === undefined
          ? Effect.map(
              Effect.provide(
                saveUCFactory<TEntity>(),
                ctx.pipe(Context.add(EntityTag, next)),
              ),
              settled,
            )
          : writer.save(next),
      intent: () => ({ entity: entityName, write: 'save' }),
      confirm: () => {
        draft?.clear();
        void refreshList();
        if (mounted.current) afterSave();
      },
    });
    const deleteMutation = useOptimisticMutation<EntityId, void>({
      write: target =>
        writer === undefined
          ? Effect.as(
              Effect.provide(
                deleteUCFactory<TEntity>(),
                ctx.pipe(Context.add(EntityIdTag, target)),
              ),
              settled(undefined),
            )
          : writer.delete(target),
      intent: () => ({ entity: entityName, write: 'delete' }),
      confirm: () => {
        draft?.clear();
        void refreshList();
        if (mounted.current) afterDelete();
      },
    });

    const handleSave = async (next: TEntity) => {
      const result = await saveMutation.mutate(next).catch(() => undefined);
      // Failed, or pending: the form stays, and the mutation says which. A
      // pending write leaves through the mutation's `confirm`, once its flow
      // completed.
      if (result?._tag !== 'settled') return;
      draft?.clear();
      void refreshList();
      // Said in the toast region every route shares, so it survives the
      // navigation that follows (ADR 0028).
      toasts?.show({
        tone: 'success',
        message: ct('state.saved', {
          object: recordNoun(next),
        }),
      });
      afterSave();
    };

    const toasts = useToasts();
    const ct = useT('controls');
    const et = useT('entity');
    /** What an announcement names: the record, or the entity for a blank one. */
    const recordNoun = (record: TEntity | undefined) =>
      recordLabelOf(record) ?? et(labelKey.replace(/^entity:/, ''));
    /**
     * Saves a deleted record back under its id: what Undo runs under the
     * `undo` policy.
     */
    const restore = (record: TEntity) =>
      Effect.runPromise(
        writer === undefined
          ? Effect.asVoid(
              Effect.provide(
                saveUCFactory<TEntity>(),
                ctx.pipe(Context.add(EntityTag, record)),
              ),
            )
          : Effect.asVoid(writer.save(record)),
      ).then(
        () => refreshList(),
        (failure: unknown) => {
          toasts?.show({ tone: 'failure', failure: asFailure(failure) });
        },
      );

    const handleDelete = async () => {
      const snapshot = entity;
      const result = await deleteMutation.mutate(id).catch(() => undefined);
      if (result?._tag !== 'settled') return;
      draft?.clear();
      void refreshList();
      // Said once, in the toast region every route shares, so it survives the
      // navigation back to the list.
      const object = recordNoun(snapshot);
      const message = ct('confirm.deleted', { object });
      if (deletePolicy === 'undo' && snapshot !== undefined)
        toasts?.show({
          tone: 'undo',
          message,
          action: {
            label: ct('confirm.undo'),
            onAction: () => void restore(snapshot),
          },
        });
      else toasts?.show({ tone: 'success', message });
      afterDelete();
    };

    /**
     * An `entity`-bound verb, on the record being shown.
     *
     * It **reloads** — once the verb took effect, which for one the server
     * handed to a flow is when the flow completed — rather than patching what it has: the service decides the
     * resulting state — a `publish` may land on `published` from four different
     * places — and a client that assumed the new value would show the wrong one
     * the first time the rule changed. `id == null` means the create form,
     * where there is no record to act on and the form renders no verbs anyway.
     *
     * ⚠️ The rejection is **caught and shown**, never left to the promise.
     * `EntityForm`'s `onUseCase` returns `void`, so an uncaught rejection here
     * reaches the console and nothing else — measured on an offering refusing
     * `unpublish` from `draft`: the service answered `409` with a coded body,
     * the record correctly did not move, and the operator saw a button that
     * appeared to do nothing at all.
     */
    const verbs = verbsOf(
      useCases === undefined
        ? undefined
        : (adapters[useCases] as EntityUseCaseRunner),
      affordances.metadata?.useCases,
    );
    const recordVerb = useVerb(verbs, () => void reload());
    const handleUseCase =
      verbs === undefined || id == null
        ? undefined
        : (key: string) => recordVerb.run(key, id);

    return (
      <EntityCrudForm<TEntity>
        // Remounts (and reseeds the fields) once the record arrives.
        key={String(entity?.id ?? CATALOG_NEW_SLUG)}
        entityConstructor={entityConstructor}
        catalogKey={catalogKey}
        metadataSource={metadataSource}
        hiddenFields={hiddenFields}
        links={linkSources}
        entity={entity}
        isLoading={isLoading}
        isSaving={saveMutation.status === 'running'}
        isPending={[saveMutation, deleteMutation, recordVerb.verb].some(
          mutation => mutation.status === 'pending',
        )}
        isDeleting={deleteMutation.status === 'running'}
        error={
          loadError ??
          syncFailure(saveMutation) ??
          syncFailure(deleteMutation) ??
          syncFailure(recordVerb.verb)
        }
        onSave={handleSave}
        onRetry={loadError === undefined ? undefined : reload}
        onDelete={id == null ? undefined : handleDelete}
        deletePolicy={deletePolicy}
        onUseCase={handleUseCase}
        backHref={withLocale(basePath)}
        renderLink={renderLink}
        draft={draft}
      />
    );
  }

  return {
    entityConstructor,
    entityKey: catalogKey,
    entityLabelKey,
    entityPluralKey,
    basePath,
    ListPage,
    SingleViewPage,
  };
}
