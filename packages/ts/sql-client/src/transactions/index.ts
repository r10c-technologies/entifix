/**
 * The half of this package that needs `@entifix/transactions`: the unit of
 * work, the outbox and its relay, the inboxes and the idempotency store over
 * SQL. Behind a subpath, with that package an optional peer, so entity CRUD
 * over SQL does not arrive with the outbox attached.
 */
export * from './idempotency.js';
export * from './outbox.js';
export * from './relay.js';
export * from './schema.js';
export * from './unit-of-work.js';
