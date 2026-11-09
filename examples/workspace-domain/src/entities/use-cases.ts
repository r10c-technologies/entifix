import { useCase } from '@entifix/core';

import { Invoice } from './invoice.entity.js';

/**
 * The verbs beyond read, write and delete, declared on the entity so every
 * surface can find them.
 *
 * Where each one appears is its binding and placement, not a component prop:
 * `issue` is bound to one invoice and sits in the form header; `reset-demo` is
 * bound to nothing and so reaches only the command palette.
 *
 * In a served application these descriptors arrive filtered by the verified
 * principal from `$metadata`. This example has no principal, so
 * `../metadata.ts` reads them straight off the class.
 */
@useCase({
  entity: Invoice,
  key: 'issue',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:invoice.useCases.issue',
})
export class IssueInvoiceUC {}

@useCase({
  entity: Invoice,
  key: 'reset-demo',
  binding: 'unbound',
  placement: 'context-independent',
  labelKey: 'entity:invoice.useCases.resetDemo',
  keywordsKey: 'entity:invoice.useCases.resetDemoKeywords',
})
export class ResetDemoUC {}

/**
 * Voids one invoice, from its row. Destructive, and reversible by Undo: it
 * acts at once, and the toast that says so offers Undo, which runs `reopen`.
 */
@useCase({
  entity: Invoice,
  key: 'void',
  binding: 'entity',
  placement: 'context-dependent',
  labelKey: 'entity:invoice.useCases.void',
  confirm: {
    tone: 'destructive',
    messageKey: 'entity:invoice.useCases.voidConfirm',
    doneKey: 'entity:invoice.useCases.voided',
  },
  reversible: 'undo',
  inverse: 'reopen',
})
export class VoidInvoiceUC {}

/** Puts a voided invoice back to draft — what Undo on `void` runs. */
@useCase({
  entity: Invoice,
  key: 'reopen',
  binding: 'entity',
  placement: 'context-dependent',
  labelKey: 'entity:invoice.useCases.reopen',
})
export class ReopenInvoiceUC {}

/**
 * Deletes every draft the list's filter matches, from the toolbar. It acts on
 * the whole collection with no selection, which is exactly why it asks first.
 */
@useCase({
  entity: Invoice,
  key: 'purge-drafts',
  binding: 'collection',
  placement: 'context-independent',
  labelKey: 'entity:invoice.useCases.purgeDrafts',
  confirm: {
    tone: 'destructive',
    messageKey: 'entity:invoice.useCases.purgeDraftsConfirm',
  },
  reversible: 'confirm',
})
export class PurgeDraftInvoicesUC {}
