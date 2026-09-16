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
