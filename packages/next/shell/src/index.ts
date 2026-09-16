// Use this file to export React client components (e.g. those with 'use client' directive) or other non-server utilities

export * from './lib/back-office/index.js';
export * from './lib/command-palette/index.js';
export * from './lib/crud/index.js';
export * from './lib/i18n/index.js';
// The browser half of record search: a typed `fetch` and the shapes it returns.
// The route handler and the source declarations stay in `/server`, since they
// read cookies and would be stamped as client references here.
export type * from './lib/search/record-search.types.js';
export * from './lib/search/search-records.js';
export * from './lib/session/index.js';
// Type-only, so it stays erased: the account-link *values* ship from `/server`
// (see src/server.ts), but `AccountMenuProps` names these types and a consumer
// of the client entry has to be able to name them too.
export type {
  AccountDestination,
  AccountLabelKey,
  AccountLink,
} from './lib/session/account-links.js';
export * from './lib/wizard/index.js';
export * from './lib/workspace/index.js';

/**
 * Re-exported, not redeclared. A workspace host holds an entity form's draft to
 * autosave it, so it has to be able to name the type — but the type is core's,
 * and a fourth structural copy of `Record<string, string>` beside
 * `EntityFormValues`/`EntityFormDraft`/`EntityLinkDraft` is exactly what
 * [ADR 0034](../../../../docs/adr/0034-composition-metadata.md) collapsed. One
 * declaration, reachable from the layer its consumers already depend on.
 */
export * from './lib/i18n/catalog/index.js';
export type { EntityDraft } from '@entifix/core';
