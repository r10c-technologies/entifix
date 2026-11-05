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
/**
 * How a unit of work's body answers its own driver calls' failures, so the
 * write conflict the unit retries on is never hidden behind a failure of the
 * body's choosing.
 */
export { mongoUnitFault } from '../errors/translate-mongo-error.js';
export * from '../idempotency/store.js';
export * from '../inbox/store.js';
export * from '../outbox/relay.js';
export * from '../outbox/store.js';
export * from '../unit-of-work/command-inbox.js';
export * from '../unit-of-work/mongo-unit-of-work.js';
