/**
 * The half of this package that needs `@entifix/transactions`: the
 * transactional outbox written inside the entity's own Mongo
 * transaction, and the inbox that makes a redelivered command idempotent.
 *
 * Behind a subpath so entity CRUD over Mongo does not arrive with the saga
 * engine attached. Package-level dependencies are not per-subpath, so what
 * actually keeps it optional is the `peerDependenciesMeta.optional` entry in
 * the manifest — importing this module without that peer installed is the
 * error, and it is the adopter's to make deliberately.
 */
export * from '../idempotency/store.js';
export * from '../inbox/store.js';
export * from '../outbox/metrics.js';
export * from '../outbox/relay.js';
export * from '../outbox/store.js';
export * from '../saga/store.js';
export * from '../unit-of-work/command-inbox.js';
export * from '../unit-of-work/mongo-unit-of-work.js';
